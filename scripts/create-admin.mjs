// 最初の管理者を作り、パスワード設定用の招待リンクを表示する。
// 管理者がいないと画面からユーザーを追加できないため、最初の 1 人だけはこのスクリプトで作る。
//
//   npm run admin:create:local  -- --username admin --email you@example.com
//   npm run admin:create:remote -- --username admin --email you@example.com
//
// すでに同じメールアドレスのユーザーがいる場合は、管理者に変更して招待リンクを発行し直す
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

const { values } = parseArgs({
  options: {
    username: { type: "string" },
    email: { type: "string" },
    local: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
  },
});

const username = values.username?.trim() ?? "";
const email = values.email?.trim().toLowerCase() ?? "";
if (values.local === values.remote || !username || username.length > 50 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("使い方: node scripts/create-admin.mjs (--local | --remote) --username <名前> --email <メールアドレス>");
  process.exit(1);
}

// 招待リンクのベース URL。ローカルは .dev.vars、本番は wrangler.jsonc の APP_URL を使う
const appUrl = values.local
  ? (readVar(".dev.vars", /^APP_URL=(.+)$/m) ?? "http://localhost:5173")
  : readVar("wrangler.jsonc", /"APP_URL"\s*:\s*"([^"]+)"/);
if (!appUrl) {
  console.error("wrangler.jsonc から APP_URL を読み取れませんでした");
  process.exit(1);
}

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const now = Date.now();
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

const sql = `
INSERT INTO users (id, username, email, role, created_at) VALUES (${q(randomUUID())}, ${q(username)}, ${q(email)}, 'admin', ${now})
  ON CONFLICT(email) DO UPDATE SET role = 'admin', disabled_at = NULL;
UPDATE user_tokens SET used_at = ${now}
  WHERE user_id = (SELECT id FROM users WHERE email = ${q(email)}) AND used_at IS NULL;
INSERT INTO user_tokens (token_hash, user_id, purpose, expires_at, created_at)
  SELECT ${q(tokenHash)}, id, 'invite', ${now + INVITE_TTL_MS}, ${now} FROM users WHERE email = ${q(email)};
`;

execFileSync("npx", ["wrangler", "d1", "execute", "DB", values.local ? "--local" : "--remote", "--command", sql], {
  stdio: ["ignore", "ignore", "inherit"],
});

console.log(`\n管理者 ${username}（${email}）を作成しました。`);
console.log(`次のリンクを ${INVITE_TTL_MS / 3_600_000} 時間以内に開いて、パスワードを設定してください。\n`);
console.log(`${appUrl}/set-password?token=${token}\n`);

function readVar(file, re) {
  if (!existsSync(file)) return undefined;
  return readFileSync(file, "utf8").match(re)?.[1]?.trim();
}
