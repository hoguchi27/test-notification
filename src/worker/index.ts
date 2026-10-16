import { Hono } from "hono";
import { csrf } from "hono/csrf";
import type { Notification, UserSummary } from "../shared/types";
import type { AppEnv, Env } from "./env";
import { authRoutes, requireUser } from "./auth";
import { requestRoutes } from "./requests";
import { deliverPending } from "./outbox";

const app = new Hono<AppEnv>().basePath("/api");

// 別オリジンのフォームから POST されるのを防ぐ
app.use("*", (c, next) => csrf({ origin: new URL(c.env.APP_URL).origin })(c, next));

app.route("/auth", authRoutes);

app.use("/me", requireUser);
app.use("/users", requireUser);
app.use("/notifications", requireUser);
app.use("/requests/*", requireUser);
app.use("/requests", requireUser);

app.get("/me", (c) => c.json(c.get("user")));

// 承認者を選ぶための一覧。他人のメールアドレスは返さない
app.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, username FROM users WHERE id != ? ORDER BY username")
    .bind(c.get("user").id)
    .all<UserSummary>();
  return c.json(results);
});

// 自分宛てに送られた（ことになっている）通知メールの履歴
app.get("/notifications", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, subject, body, status, created_at AS createdAt, sent_at AS sentAt
     FROM outbox WHERE to_user_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(c.get("user").id)
    .all<Notification>();
  return c.json(results);
});

app.route("/requests", requestRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "サーバーでエラーが発生しました" }, 500);
});

export default {
  fetch: app.fetch,
  // Cron Trigger: 送信に失敗した / 取りこぼした通知を再送する
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(deliverPending(env));
  },
} satisfies ExportedHandler<Env>;
