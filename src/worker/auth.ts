import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Me, TokenInfo } from "../shared/types";
import type { AppEnv, Env } from "./env";
import { dummyPasswordCheck, hashPassword, randomDigits, randomToken, sha256Hex, verifyPassword } from "./crypto";
import { createMailer } from "./mailer";

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MFA_COOKIE = "mfa";
const MFA_TTL_MS = 10 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;
const TOKEN_TTL_MS = { invite: 72 * 60 * 60 * 1000, reset: 30 * 60 * 1000 } as const;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ログイン済みでなければ 401 を返し、ログイン済みなら c.get("user") を使えるようにする。
// ロールは毎回 DB から読むので、管理者がロールを変えたり無効にしたりすると次のリクエストから反映される
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return c.json({ error: "unauthorized" }, 401);

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
  )
    .bind(await sha256Hex(sid), Date.now())
    .first<Me>();
  if (!user) return c.json({ error: "unauthorized" }, 401);

  c.set("user", user);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("user").role !== "admin") return c.json({ error: "権限がありません" }, 403);
  await next();
});

// 招待リンク / パスワード再設定リンクを発行してメールで送る。
// リンクはトークンそのものなので outbox（DB）には残さず、直接送る
export async function sendUserTokenMail(
  env: Env,
  user: { id: string; username: string; email: string },
  purpose: "invite" | "reset",
): Promise<void> {
  const now = Date.now();
  const token = randomToken();
  await env.DB.batch([
    // 古いリンクは使えないようにする（再送したときに、前のメールのリンクが残らないように）
    env.DB.prepare("UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL").bind(
      now,
      user.id,
      purpose,
    ),
    env.DB.prepare(
      "INSERT INTO user_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(await sha256Hex(token), user.id, purpose, now + TOKEN_TTL_MS[purpose], now),
  ]);

  const link = `${env.APP_URL}/set-password?token=${encodeURIComponent(token)}`;
  const mail =
    purpose === "invite"
      ? {
          subject: "[承認通知サンプル] アカウントへの招待",
          text: `${user.username} さん\n\n承認通知サンプルに招待されました。\n以下のリンクを ${TOKEN_TTL_MS.invite / 3_600_000} 時間以内に開いて、パスワードを設定してください。\n${link}`,
        }
      : {
          subject: "[承認通知サンプル] パスワードの再設定",
          text: `${user.username} さん\n\n以下のリンクを ${TOKEN_TTL_MS.reset / 60_000} 分以内に開いて、新しいパスワードを設定してください。\n${link}\n\n心当たりがない場合は、このメールを破棄してください。パスワードは変更されません。`,
        };
  await createMailer(env).send({ to: user.email, ...mail });
}

export const authRoutes = new Hono<AppEnv>();

const LOGIN_FAILED = "メールアドレスまたはパスワードが正しくないか、一時的にロックされています";

// 1. メールアドレスとパスワードを確認し、正しければ 6 桁のコードをメールで送る
authRoutes.post("/login", async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>();
  const addr = email?.trim().toLowerCase() ?? "";
  if (!addr || !password) return c.json({ error: "メールアドレスとパスワードを入力してください" }, 400);

  const now = Date.now();
  const user = await c.env.DB.prepare(
    `SELECT id, username, email, password_hash, locked_until FROM users
     WHERE email = ? AND disabled_at IS NULL AND password_hash IS NOT NULL`,
  )
    .bind(addr)
    .first<{ id: string; username: string; email: string; password_hash: string; locked_until: number | null }>();

  // 登録されていない・ロック中のどちらでも同じ応答にし、メールアドレスの存在確認に使われないようにする
  if (!user) {
    await dummyPasswordCheck(password);
    return c.json({ error: LOGIN_FAILED }, 401);
  }
  if (user.locked_until && user.locked_until > now) {
    await dummyPasswordCheck(password);
    return c.json({ error: LOGIN_FAILED }, 401);
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    // 連続で失敗したら一定時間ロックする
    await c.env.DB.prepare(
      `UPDATE users SET
         locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END,
         failed_logins = CASE WHEN failed_logins + 1 >= ? THEN 0 ELSE failed_logins + 1 END
       WHERE id = ?`,
    )
      .bind(MAX_FAILED_LOGINS, now + LOCK_MS, MAX_FAILED_LOGINS, user.id)
      .run();
    return c.json({ error: LOGIN_FAILED }, 401);
  }

  const challengeId = randomToken();
  const code = randomDigits(6);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").bind(user.id),
    c.env.DB.prepare("INSERT INTO mfa_challenges (id_hash, user_id, code_hash, expires_at) VALUES (?, ?, ?, ?)").bind(
      await sha256Hex(challengeId),
      user.id,
      await sha256Hex(`${challengeId}:${code}`),
      now + MFA_TTL_MS,
    ),
  ]);

  await createMailer(c.env).send({
    to: user.email,
    subject: "[承認通知サンプル] ログイン確認コード",
    text: `${user.username} さん\n\nログイン確認コード: ${code}\n\n${MFA_TTL_MS / 60_000} 分以内に画面に入力してください。\n心当たりがない場合は、パスワードが漏れている可能性があります。パスワードを再設定してください。`,
  });

  // どのログイン試行に対するコードかは、HttpOnly の Cookie で覚えておく
  setCookie(c, MFA_COOKIE, challengeId, cookieOptions(c, MFA_TTL_MS, "/api/auth"));
  return c.json({ ok: true });
});

// 2. メールで届いた 6 桁のコードを確認し、セッションを発行する
authRoutes.post("/mfa", async (c) => {
  const { code } = await c.req.json<{ code?: string }>();
  const challengeId = getCookie(c, MFA_COOKIE);
  if (!challengeId) return c.json({ error: "もう一度ログインしてください" }, 400);
  if (!code || !/^\d{6}$/.test(code)) return c.json({ error: "6 桁の数字を入力してください" }, 400);

  const now = Date.now();
  const idHash = await sha256Hex(challengeId);
  // 試行回数を先に増やしてから判定する。同時に送られても、上限を超えて試せないようにするため
  const challenge = await c.env.DB.prepare(
    `UPDATE mfa_challenges SET attempts = attempts + 1
     WHERE id_hash = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?
     RETURNING user_id, code_hash`,
  )
    .bind(idHash, now, MFA_MAX_ATTEMPTS)
    .first<{ user_id: string; code_hash: string }>();
  if (!challenge) {
    deleteCookie(c, MFA_COOKIE, { path: "/api/auth" });
    return c.json({ error: "コードの有効期限が切れたか、入力回数の上限に達しました。もう一度ログインしてください" }, 400);
  }
  if ((await sha256Hex(`${challengeId}:${code}`)) !== challenge.code_hash) {
    return c.json({ error: "コードが正しくありません" }, 400);
  }

  // 使用済みにするのと同時に確認し、同じコードで二重にログインできないようにする
  const used = await c.env.DB.prepare(
    "UPDATE mfa_challenges SET used_at = ? WHERE id_hash = ? AND used_at IS NULL RETURNING user_id",
  )
    .bind(now, idHash)
    .first<{ user_id: string }>();
  if (!used) return c.json({ error: "もう一度ログインしてください" }, 400);

  const sid = randomToken();
  await c.env.DB.prepare(
    `INSERT INTO sessions (id_hash, user_id, expires_at)
     SELECT ?, id, ? FROM users WHERE id = ? AND disabled_at IS NULL`,
  )
    .bind(await sha256Hex(sid), now + SESSION_TTL_MS, used.user_id)
    .run();

  deleteCookie(c, MFA_COOKIE, { path: "/api/auth" });
  setCookie(c, SESSION_COOKIE, sid, cookieOptions(c, SESSION_TTL_MS, "/"));
  return c.json({ ok: true });
});

// パスワードを忘れた場合。登録の有無に関係なく同じ応答を返す
authRoutes.post("/password/forgot", async (c) => {
  const { email } = await c.req.json<{ email?: string }>();
  const addr = email?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(addr)) return c.json({ error: "メールアドレスの形式が正しくありません" }, 400);

  const user = await c.env.DB.prepare("SELECT id, username, email FROM users WHERE email = ? AND disabled_at IS NULL")
    .bind(addr)
    .first<{ id: string; username: string; email: string }>();
  if (user) await sendUserTokenMail(c.env, user, "reset");
  return c.json({ ok: true });
});

// 招待 / 再設定リンクを開いたときに、誰のリンクかを表示するための確認（トークンは消費しない）
authRoutes.post("/token", async (c) => {
  const { token } = await c.req.json<{ token?: string }>();
  if (!token) return c.json({ error: "リンクが正しくありません" }, 400);
  const info = await c.env.DB.prepare(
    `SELECT t.purpose, u.username, u.email FROM user_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > ? AND u.disabled_at IS NULL`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<TokenInfo>();
  if (!info) return c.json({ error: "リンクが無効か、有効期限が切れています" }, 400);
  return c.json(info);
});

// 招待 / 再設定リンクからパスワードを設定する
authRoutes.post("/password/set", async (c) => {
  const { token, password } = await c.req.json<{ token?: string; password?: string }>();
  if (!token) return c.json({ error: "リンクが正しくありません" }, 400);
  if (!password || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return c.json({ error: `パスワードは ${PASSWORD_MIN}〜${PASSWORD_MAX} 文字で入力してください` }, 400);
  }

  const now = Date.now();
  // 使用済みにするのと検証を 1 文で行い、同じリンクが二重に使われるのを防ぐ
  const used = await c.env.DB.prepare(
    `UPDATE user_tokens SET used_at = ?
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
       AND user_id IN (SELECT id FROM users WHERE disabled_at IS NULL)
     RETURNING user_id`,
  )
    .bind(now, await sha256Hex(token), now)
    .first<{ user_id: string }>();
  if (!used) return c.json({ error: "リンクが無効か、有効期限が切れています" }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?").bind(
      await hashPassword(password),
      used.user_id,
    ),
    // パスワードを変えたら、ほかの端末のログインと未使用のリンクは無効にする
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(used.user_id),
    c.env.DB.prepare("UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL").bind(now, used.user_id),
  ]);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256Hex(sid)).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

function cookieOptions(c: Context<AppEnv>, ttlMs: number, path: string) {
  return {
    httpOnly: true,
    secure: new URL(c.env.APP_URL).protocol === "https:",
    sameSite: "Lax" as const,
    path,
    maxAge: ttlMs / 1000,
  };
}
