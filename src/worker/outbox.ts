import type { Env } from "./env";
import { createMailer } from "./mailer";

const MAX_ATTEMPTS = 5;

export type OutboxMail = {
  id: string;
  toUserId: string;
  toEmail: string;
  subject: string;
  body: string;
};

// 通知メールを outbox テーブルに積む文を作る。
// 業務データの更新と同じ DB.batch() に入れることで、
// 「承認はされたのに通知が記録されていない」状態を防ぐ（Transactional Outbox）。
//
// onlyIfChanged = true のときは、直前の UPDATE が 1 行を変更した場合だけ INSERT する。
// 二重承認などで UPDATE が空振りしたときに、通知だけが積まれるのを防ぐ
export function enqueueMail(db: D1Database, mail: OutboxMail, onlyIfChanged = false): D1PreparedStatement {
  const sql = `
    INSERT INTO outbox (id, to_user_id, to_email, subject, body, status, created_at)
    SELECT ?, ?, ?, ?, ?, 'pending', ?
    ${onlyIfChanged ? "WHERE changes() = 1" : ""}`;
  return db.prepare(sql).bind(mail.id, mail.toUserId, mail.toEmail, mail.subject, mail.body, Date.now());
}

type OutboxRow = { id: string; to_email: string; subject: string; body: string };

// 未送信のメールを送る。リクエスト処理では waitUntil() から、
// 再送は Cron（scheduled）から呼ぶ
export async function deliverPending(env: Env, ids?: string[]): Promise<void> {
  const mailer = createMailer(env);

  let rows: OutboxRow[];
  if (ids) {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    rows = (
      await env.DB.prepare(
        `SELECT id, to_email, subject, body FROM outbox WHERE status = 'pending' AND id IN (${placeholders})`,
      )
        .bind(...ids)
        .all<OutboxRow>()
    ).results;
  } else {
    // 直後に waitUntil() 側で送信中のものと重ならないよう、1 分以上前のものだけを対象にする
    rows = (
      await env.DB.prepare(
        `SELECT id, to_email, subject, body FROM outbox
         WHERE status IN ('pending', 'failed') AND attempts < ? AND created_at < ?
         ORDER BY created_at LIMIT 50`,
      )
        .bind(MAX_ATTEMPTS, Date.now() - 60_000)
        .all<OutboxRow>()
    ).results;
  }

  for (const row of rows) {
    try {
      await mailer.send({ to: row.to_email, subject: row.subject, text: row.body });
      await env.DB.prepare(
        "UPDATE outbox SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?",
      )
        .bind(Date.now(), row.id)
        .run();
    } catch (e) {
      await env.DB.prepare(
        "UPDATE outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?",
      )
        .bind(String(e).slice(0, 500), row.id)
        .run();
    }
  }
}
