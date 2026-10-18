import { Hono } from "hono";
import { canApprove, type ApprovalRequest, type RequestStatus } from "../shared/types";
import type { AppEnv } from "./env";
import { deliverPending, enqueueMail } from "./outbox";

type RequestRow = {
  id: string;
  title: string;
  body: string;
  status: RequestStatus;
  comment: string | null;
  applicant_name: string;
  approver_name: string;
  created_at: number;
  decided_at: number | null;
};

const SELECT_REQUESTS = `
  SELECT r.id, r.title, r.body, r.status, r.comment, r.created_at, r.decided_at,
         a.username AS applicant_name, p.username AS approver_name
  FROM requests r
  JOIN users a ON a.id = r.applicant_id
  JOIN users p ON p.id = r.approver_id`;

function toApi(r: RequestRow): ApprovalRequest {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    status: r.status,
    comment: r.comment,
    applicantName: r.applicant_name,
    approverName: r.approver_name,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  };
}

export const requestRoutes = new Hono<AppEnv>();

requestRoutes.get("/", async (c) => {
  const me = c.get("user");
  const [mine, toApprove] = await c.env.DB.batch<RequestRow>([
    c.env.DB.prepare(`${SELECT_REQUESTS} WHERE r.applicant_id = ? ORDER BY r.created_at DESC`).bind(me.id),
    c.env.DB.prepare(`${SELECT_REQUESTS} WHERE r.approver_id = ? ORDER BY r.status = 'pending' DESC, r.created_at DESC`).bind(me.id),
  ]);
  return c.json({ mine: mine.results.map(toApi), toApprove: toApprove.results.map(toApi) });
});

// 申請する → 承認者に通知
requestRoutes.post("/", async (c) => {
  const me = c.get("user");
  const { title, body, approverId } = await c.req.json<{ title?: string; body?: string; approverId?: string }>();
  const t = title?.trim() ?? "";
  const b = body?.trim() ?? "";
  if (!t || t.length > 100) return c.json({ error: "件名は 1〜100 文字で入力してください" }, 400);
  if (b.length > 2000) return c.json({ error: "内容は 2000 文字以内で入力してください" }, 400);
  if (!approverId || approverId === me.id) return c.json({ error: "自分以外の承認者を選択してください" }, 400);

  // 承認できるロールの、利用中のユーザーだけを承認者にできる
  const approver = await c.env.DB.prepare(
    `SELECT id, username, email FROM users
     WHERE id = ? AND role IN ('approver', 'admin') AND password_hash IS NOT NULL AND disabled_at IS NULL`,
  )
    .bind(approverId)
    .first<{ id: string; username: string; email: string }>();
  if (!approver) return c.json({ error: "承認者が見つかりません" }, 400);

  const requestId = crypto.randomUUID();
  const mailId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO requests (id, title, body, applicant_id, approver_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    ).bind(requestId, t, b, me.id, approver.id, Date.now()),
    enqueueMail(c.env.DB, {
      id: mailId,
      toUserId: approver.id,
      toEmail: approver.email,
      subject: `[承認依頼] ${t}`,
      body: `${approver.username} さん\n\n${me.username} さんから承認依頼が届きました。\n\n件名: ${t}\n内容:\n${b}\n\n確認はこちら: ${c.env.APP_URL}/`,
    }),
  ]);

  // メール送信は応答を返したあとに行い、画面の操作を待たせない
  c.executionCtx.waitUntil(deliverPending(c.env, [mailId]));
  return c.json({ id: requestId }, 201);
});

// 承認 / 却下する → 申請者に通知
requestRoutes.post("/:id/decision", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  const { decision, comment } = await c.req.json<{ decision?: string; comment?: string }>();
  // 承認者に指定されたあとで一般ユーザーに変更された場合は、承認 / 却下できない
  if (!canApprove(me.role)) return c.json({ error: "承認する権限がありません" }, 403);
  if (decision !== "approved" && decision !== "rejected") return c.json({ error: "decision が不正です" }, 400);
  const note = comment?.trim() || null;
  if (note && note.length > 1000) return c.json({ error: "コメントは 1000 文字以内で入力してください" }, 400);

  const req = await c.env.DB.prepare(
    `SELECT r.title, r.approver_id, r.status, a.id AS applicant_id, a.username AS applicant_name, a.email AS applicant_email
     FROM requests r JOIN users a ON a.id = r.applicant_id WHERE r.id = ?`,
  )
    .bind(id)
    .first<{ title: string; approver_id: string; status: RequestStatus; applicant_id: string; applicant_name: string; applicant_email: string }>();
  // 承認者以外には存在自体を見せない
  if (!req || req.approver_id !== me.id) return c.json({ error: "申請が見つかりません" }, 404);
  if (req.status !== "pending") return c.json({ error: "この申請はすでに処理済みです" }, 409);

  const label = decision === "approved" ? "承認" : "却下";
  const mailId = crypto.randomUUID();
  // SELECT から UPDATE までの間に別タブなどで処理された場合に備え、
  // UPDATE にも status = 'pending' の条件を付ける。空振りしたら通知も積まない
  const [update] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE requests SET status = ?, comment = ?, decided_at = ?
       WHERE id = ? AND approver_id = ? AND status = 'pending'`,
    ).bind(decision, note, Date.now(), id, me.id),
    enqueueMail(
      c.env.DB,
      {
        id: mailId,
        toUserId: req.applicant_id,
        toEmail: req.applicant_email,
        subject: `[${label}] ${req.title}`,
        body: `${req.applicant_name} さん\n\n申請「${req.title}」が ${me.username} さんにより${label}されました。\n${note ? `\nコメント:\n${note}\n` : ""}\n確認はこちら: ${c.env.APP_URL}/`,
      },
      true,
    ),
  ]);
  if (update.meta.changes !== 1) return c.json({ error: "この申請はすでに処理済みです" }, 409);

  c.executionCtx.waitUntil(deliverPending(c.env, [mailId]));
  return c.json({ ok: true });
});
