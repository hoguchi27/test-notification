import type { Env } from "./env";

export type Mail = {
  to: string;
  subject: string;
  text: string;
};

// 送信手段を差し替えられるように、インターフェース越しに使う
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

// 開発用: 実際には送らず、内容をコンソール（wrangler / vite のログ）に出すだけ。
// 招待リンクやログイン確認コードもそのまま出力されるので、本番では使わないこと
export class ConsoleMailer implements Mailer {
  async send(mail: Mail): Promise<void> {
    console.log(
      ["", "========== [mail] ==========", `To: ${mail.to}`, `Subject: ${mail.subject}`, "", mail.text, "============================", ""].join("\n"),
    );
  }
}

// 実際に送信したくなったら、ここで Resend / SendGrid / Cloudflare Email などの
// 実装を返すようにする。API キーは `wrangler secret put` で登録し、Env 経由で受け取る
export function createMailer(_env: Env): Mailer {
  return new ConsoleMailer();
}
