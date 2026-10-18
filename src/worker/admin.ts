import { Hono } from "hono";
import type { AdminUser, Role } from "../shared/types";
import type { AppEnv } from "./env";
import { EMAIL_RE, requireAdmin, sendUserTokenMail } from "./auth";

const ROLES: Role[] = ["member", "approver", "admin"];

type UserRow = {
  id: string;
  username: string;
  email: string;
  role: Role;
  password_hash: string | null;
  disabled_at: number | null;
  created_at: number;
};

function toApi(u: UserRow): AdminUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    status: u.disabled_at ? "disabled" : u.password_hash ? "active" : "invited",
    createdAt: u.created_at,
  };
}

// requireUser のあとに使う（index.ts で設定）
export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAdmin);

adminRoutes.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, username, email, role, password_hash, disabled_at, created_at FROM users ORDER BY created_at",
  ).all<UserRow>();
  return c.json(results.map(toApi));
});

// ユーザーを追加し、招待リンクをメールで送る
adminRoutes.post("/users", async (c) => {
  const { username, email, role } = await c.req.json<{ username?: string; email?: string; role?: string }>();
  const name = username?.trim() ?? "";
  const addr = email?.trim().toLowerCase() ?? "";
  if (!name || name.length > 50) return c.json({ error: "ユーザー名は 1〜50 文字で入力してください" }, 400);
  if (!EMAIL_RE.test(addr) || addr.length > 254) return c.json({ error: "メールアドレスの形式が正しくありません" }, 400);
  if (!ROLES.includes(role as Role)) return c.json({ error: "ロールが正しくありません" }, 400);

  const user = await c.env.DB.prepare(
    `INSERT INTO users (id, username, email, role, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO NOTHING
     RETURNING id, username, email`,
  )
    .bind(crypto.randomUUID(), name, addr, role, Date.now())
    .first<{ id: string; username: string; email: string }>();
  if (!user) return c.json({ error: "このメールアドレスのユーザーはすでに登録されています" }, 409);

  await sendUserTokenMail(c.env, user, "invite");
  return c.json({ id: user.id }, 201);
});

// ロールの変更と、無効化 / 有効化
adminRoutes.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const { role, disabled } = await c.req.json<{ role?: string; disabled?: boolean }>();
  // 自分自身の権限を外したり無効にしたりすると、管理者がいなくなるおそれがあるので禁止する
  if (id === c.get("user").id) return c.json({ error: "自分自身のロールや状態は変更できません" }, 400);
  if (role !== undefined && !ROLES.includes(role as Role)) return c.json({ error: "ロールが正しくありません" }, 400);
  if (role === undefined && disabled === undefined) return c.json({ error: "変更内容がありません" }, 400);

  const stmts = [];
  if (role !== undefined) {
    stmts.push(c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id));
  }
  if (disabled === true) {
    stmts.push(c.env.DB.prepare("UPDATE users SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL").bind(Date.now(), id));
    // 無効にしたユーザーは、ログイン中のセッションもすぐに使えなくする
    stmts.push(c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  } else if (disabled === false) {
    stmts.push(c.env.DB.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").bind(id));
  }
  stmts.push(
    c.env.DB.prepare(
      "SELECT id, username, email, role, password_hash, disabled_at, created_at FROM users WHERE id = ?",
    ).bind(id),
  );

  const results = await c.env.DB.batch<UserRow>(stmts);
  const user = results[results.length - 1].results[0];
  if (!user) return c.json({ error: "ユーザーが見つかりません" }, 404);
  return c.json(toApi(user));
});

// 招待リンクを再送する（パスワード未設定のユーザーだけ）
adminRoutes.post("/users/:id/invite", async (c) => {
  const user = await c.env.DB.prepare(
    "SELECT id, username, email FROM users WHERE id = ? AND password_hash IS NULL AND disabled_at IS NULL",
  )
    .bind(c.req.param("id"))
    .first<{ id: string; username: string; email: string }>();
  if (!user) return c.json({ error: "招待中のユーザーが見つかりません" }, 404);

  await sendUserTokenMail(c.env, user, "invite");
  return c.json({ ok: true });
});
