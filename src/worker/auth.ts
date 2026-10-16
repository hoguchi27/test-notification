import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Me } from "../shared/types";
import type { AppEnv } from "./env";
import { randomToken, sha256Hex } from "./crypto";
import { createMailer } from "./mailer";

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ログイン済みでなければ 401 を返し、ログイン済みなら c.get("user") を使えるようにする
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return c.json({ error: "unauthorized" }, 401);

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(sid), Date.now())
    .first<Me>();
  if (!user) return c.json({ error: "unauthorized" }, 401);

  c.set("user", user);
  await next();
});

export const authRoutes = new Hono<AppEnv>();

// 1. ユーザー名とメールアドレスを受け取り、ワンタイムログインリンクをメールで送る
authRoutes.post("/request", async (c) => {
  const { username, email } = await c.req.json<{ username?: string; email?: string }>();
  const name = username?.trim() ?? "";
  const addr = email?.trim().toLowerCase() ?? "";
  if (!name || name.length > 50) return c.json({ error: "ユーザー名は 1〜50 文字で入力してください" }, 400);
  if (!EMAIL_RE.test(addr) || addr.length > 254) return c.json({ error: "メールアドレスの形式が正しくありません" }, 400);

  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO login_tokens (token_hash, email, username, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), addr, name, Date.now() + LOGIN_TOKEN_TTL_MS)
    .run();

  // ログインリンクはトークンそのものなので outbox（DB）には残さず、直接送る
  const link = `${c.env.APP_URL}/verify?token=${encodeURIComponent(token)}`;
  await createMailer(c.env).send({
    to: addr,
    subject: "[承認通知サンプル] ログイン用リンク",
    text: `${name} さん\n\n以下のリンクを ${LOGIN_TOKEN_TTL_MS / 60000} 分以内に開いてログインしてください。\n${link}\n\n心当たりがない場合は、このメールを破棄してください。`,
  });

  // 登録済みかどうかに関係なく同じ応答を返す（メールアドレスの存在確認に使われないように）
  return c.json({ ok: true });
});

// 2. リンク先の画面からトークンを POST してもらい、セッションを発行する。
//    GET で即ログインにしないのは、メールのセキュリティスキャナが
//    リンクを先に開いてトークンを消費してしまうことがあるため
authRoutes.post("/verify", async (c) => {
  const { token } = await c.req.json<{ token?: string }>();
  if (!token) return c.json({ error: "トークンがありません" }, 400);

  const now = Date.now();
  // 使用済みフラグを立てるのと検証を 1 文で行い、同じトークンが二重に使われるのを防ぐ
  const login = await c.env.DB.prepare(
    `UPDATE login_tokens SET used_at = ?
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
     RETURNING email, username`,
  )
    .bind(now, await sha256Hex(token), now)
    .first<{ email: string; username: string }>();
  if (!login) return c.json({ error: "リンクが無効か、有効期限が切れています" }, 400);

  const user = await c.env.DB.prepare(
    `INSERT INTO users (id, username, email, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET username = excluded.username
     RETURNING id`,
  )
    .bind(crypto.randomUUID(), login.username, login.email, now)
    .first<{ id: string }>();
  if (!user) return c.json({ error: "ユーザーを登録できませんでした" }, 500);

  const sid = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(sid), user.id, now + SESSION_TTL_MS)
    .run();

  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: new URL(c.env.APP_URL).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
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
