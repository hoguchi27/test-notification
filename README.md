# 承認通知サンプル（Cloudflare Workers + D1 + Hono + React）

業務用 Web アプリで「申請」「承認」「却下」のような区切りになる操作をしたときに、
関係者にメールで通知する仕組みのサンプルです。

- **申請する** → 承認者に「承認依頼」メール
- **承認 / 却下する** → 申請者に「承認 / 却下」メール
- ユーザーは管理者が追加し、招待メールのリンクから本人がパスワードを設定する
- ログインはパスワードと、メールで届く 6 桁の確認コードの 2 段階（多要素認証）

> [!NOTE]
> このサンプルは **実際にはメールを送りません**。送ったことにして、内容を `npm run dev` を実行しているターミナルに
> 出力し、D1 の `outbox` テーブルに記録するだけです。画面の「あなた宛ての通知メール」で内容を確認できます。
> 実際に送るように切り替える方法は「[実際にメールを送るには](#実際にメールを送るには)」を参照してください。

## 構成

| 層 | 使っているもの |
|---|---|
| フロントエンド | React + TypeScript（Vite） |
| API | Hono（Cloudflare Workers 上で動く） |
| DB | Cloudflare D1（SQLite） |
| 開発サーバー | `@cloudflare/vite-plugin`（フロントと Worker を 1 つの `vite` で起動） |

```
migrations/                テーブル定義
scripts/create-admin.mjs   最初の管理者を作るスクリプト
src/shared/types.ts        フロントと API で共有する型（ロールの定義も含む）
src/worker/index.ts        API のエントリポイント（ルーティング、Cron）
src/worker/auth.ts         ログイン（パスワード + 確認コード）、招待・再設定リンク、セッション
src/worker/admin.ts        管理者向けのユーザー管理 API
src/worker/crypto.ts       トークン・確認コードの生成、パスワードのハッシュ化
src/worker/requests.ts     申請・承認・却下 と 通知の登録
src/worker/outbox.ts       通知メールのキュー（outbox）と送信処理
src/worker/mailer.ts       メール送信の抽象化（今はコンソールに出力するだけ）
src/react-app/             画面（ログイン、パスワード設定・再設定、ダッシュボード、ユーザー管理）
```

## 動かし方

Node.js 22.12 以上が必要です。また、ローカルで Worker を動かす `workerd` は glibc 2.35 以上が必要なので、
WSL では Ubuntu 22.04 以降を使ってください（Ubuntu 20.04 では起動しません）。

```bash
npm install
cp .dev.vars.example .dev.vars   # ローカル用の APP_URL（http://localhost:5173）
npm run db:migrate:local   # ローカルの D1 にテーブルを作る（.wrangler/ 以下に保存される）
npm run admin:create:local -- --username admin --email admin@example.com   # 最初の管理者を作る
npm run dev                # http://localhost:5173
```

1. `admin:create:local` が表示した招待リンクを開いて、管理者のパスワードを設定します。
2. メールアドレスとパスワードでログインします。ターミナルに `[mail]` で始まるブロックが出力されるので、
   その中の 6 桁の確認コードを入力します。
3. 右上の「ユーザー管理」から、承認者ロールと一般ロールのユーザーを追加します。招待メールの内容がターミナルに出るので、
   そのリンクを別のブラウザかシークレットウィンドウで開いて、パスワードを設定します。
4. 一般ユーザーで申請すると承認者宛ての通知が、承認者で承認 / 却下すると申請者宛ての通知が、ターミナルと画面に出ます。

### ロール

| ロール | できること |
|---|---|
| 一般（`member`） | 申請する |
| 承認者（`approver`） | 申請する、自分宛ての申請を承認 / 却下する |
| 管理者（`admin`） | 申請する、承認 / 却下する、ユーザーを追加・ロール変更・無効化する、招待を再送する |

ダミーのアドレス（`alice@example.com` など）で問題なく試せます。

## 実装ポイント

### 1. 通知は「業務データの更新」と同じトランザクションで記録する（Transactional Outbox）

承認ボタンの処理の中でメール API を直接呼ぶと、次のような問題が起きます。

- メール API が遅いと、ボタンを押してからの応答も遅くなる
- メール送信に失敗したときに、承認の取り消し（ロールバック）をするのかどうかが曖昧になる
- 承認を DB に保存する前にプロセスが落ちると、通知だけ送られて承認は保存されない（逆も起きる）

そこでこのサンプルでは、次の手順にしています（[requests.ts](src/worker/requests.ts)）。

1. `requests` の更新と `outbox` への INSERT を **同じ `DB.batch()`** で実行する。D1 の batch はトランザクションとして実行されるので、両方が保存されるか、どちらも保存されないかのどちらかになる
2. API の応答を返したあと、`c.executionCtx.waitUntil()` の中で `outbox` からメールを送る
3. 送れたら `status = 'sent'` にし、失敗したら `failed` にして `attempts` を増やす
4. **Cron Trigger**（5 分ごと）で `pending` / `failed` のものを再送する（最大 5 回）

> 本格的に運用する場合は、2〜4 を **Cloudflare Queues** に置き換えると、リトライや
> デッドレターキューを自分で作らずに済みます。

### 2. 二重承認と、それによる二重通知を防ぐ

承認者が 2 つのタブで同時にボタンを押した場合などに備えて、次のようにしています。

- `UPDATE ... WHERE id = ? AND approver_id = ? AND status = 'pending'` のように、条件付きで更新する
- 通知の INSERT には `WHERE changes() = 1` を付け、直前の UPDATE が実際に 1 行を更新したときだけ通知を積む
- UPDATE の `meta.changes` が 1 でなければ 409 を返す

### 3. 通知のきっかけになる操作は、サーバー側で権限を確認する

- 承認 / 却下できるのは、その申請の `approver_id` 本人だけ（それ以外の人には 404 を返し、申請の存在自体を見せない）
- 承認者に選べるのは、承認者 / 管理者ロールの利用中のユーザーだけ。承認時にも、現在のロールを確認する
- 自分自身を承認者にはできない
- ユーザー管理 API（`/api/admin/*`）は管理者だけが使える。ロールは毎リクエスト DB から読むので、変更はすぐに反映される
- 管理者は自分自身のロール変更・無効化はできない（管理者が 1 人もいなくなるのを防ぐ）
- 通知先のメールアドレスはクライアントから受け取らず、サーバー側で DB から引く（任意のアドレスにメールを送らせる踏み台にされないように）

### 4. メール送信はインターフェースで抽象化する

[mailer.ts](src/worker/mailer.ts) の `Mailer` インターフェースだけに依存するようにしているので、
開発中はコンソールに出力し、本番では実際のメールサービスを使う、という切り替えが 1 か所の変更で済みます。

### 5. 招待・パスワード・多要素認証

**招待とパスワード設定**

- 誰でも登録できる画面はなく、ユーザーは管理者が追加する。追加すると、パスワード設定用の招待リンク（72 時間有効）がメールで届く
- 最初の管理者だけは、[create-admin.mjs](scripts/create-admin.mjs) で DB に直接作り、招待リンクをターミナルに表示する
- 招待リンク・再設定リンクのトークンは 32 バイトの乱数で、DB には **SHA-256 ハッシュだけ** を保存する（セッション ID も同じ扱い）
- リンクは一度しか使えない。`UPDATE ... RETURNING` で「検証」と「使用済みにする」処理を 1 文で行う。再送すると古いリンクは使えなくなる
- リンクを開いただけではトークンを消費せず、パスワードを送信したときに使用済みにする
  （メールのセキュリティスキャナが先にリンクを開いても問題ないように）
- パスワードを設定・再設定すると、そのユーザーのほかのセッションと未使用のリンクは無効にする
- リンクを含むメールは `outbox` に入れない（トークンを DB に平文で残さないため）

**パスワードの保存とログイン**

- パスワードは PBKDF2-SHA256（100,000 回、ソルト付き）でハッシュ化して保存する。Workers の PBKDF2 は 100,000 回が上限
- 5 回続けて間違えると 15 分ロックする
- 登録されていない・ロック中・パスワード違いのどれでも同じエラーを返し、存在しないアドレスでもハッシュ計算をして応答時間をそろえる
  （メールアドレスの存在確認に使われないように）。パスワード再設定の受付も、登録の有無に関係なく同じ応答を返す

**多要素認証（メールで 6 桁のコード）**

- パスワードが正しいと 6 桁のコード（10 分有効）をメールで送り、どのログイン試行に対するコードかを `HttpOnly` の Cookie で覚えておく
- コードの入力は 5 回まで。試行回数は判定の前に `UPDATE` で増やし、同時に送られても上限を超えて試せないようにする
- コードを確認できてから、はじめてセッションを発行する

**Cookie と CSRF**

- Cookie は `HttpOnly` と `SameSite=Lax`、本番（https）では `Secure` も付ける。POST には `hono/csrf` で Origin を確認する

### 6. 個人情報を画面や API に出しすぎない

- 承認者を選ぶ一覧（`GET /api/users`）では、ユーザー名だけを返し、メールアドレスは返さない
- メールアドレスを返すのは、ログイン中の本人の情報（`GET /api/me`）と、管理者向けのユーザー一覧（`GET /api/admin/users`）だけ

## 個人情報（ユーザー名・メールアドレス）と GitHub での公開について

ユーザー名やメールアドレスは **D1（Cloudflare 上のデータベース）にだけ保存** されるので、
ソースコードを GitHub で公開しても、それだけでは漏れません。ただし、次の点に注意してください。

| 漏れる可能性があるところ | このリポジトリでの対策 |
|---|---|
| ローカルで開発すると、ローカルの D1（SQLite）が `.wrangler/` に作られる | `.gitignore` に追加済み |
| 動作確認用の seed SQL やテストに、本物のアドレスを書いてしまう | seed は用意していない。書く場合は `example.com` などのダミーを使う |
| メールサービスの API キー | `wrangler secret put` で登録し、ローカルでは `.dev.vars` に書く（`.gitignore` に追加済み） |
| Workers のログ（`wrangler tail` や Workers Logs） | `ConsoleMailer` は宛先とログインリンクをログに出すので、**本番では使わない** |
| **デプロイしたアプリ自体** | ソースを公開していなくても、API の作りが悪ければここから漏れる。上の「実装ポイント 6」を参照。社内向けにするなら Cloudflare Access でアプリ全体を保護するのが確実 |

なお、`wrangler.jsonc` の `database_id` は秘密情報ではありません（Cloudflare アカウントの認証情報がなければ
アクセスできません）。気になる場合は、公開リポジトリにはダミー値を置いたままにしておく運用もできます。

コミット前に、次のコマンドで意図しないファイルが含まれていないか確認すると安心です。

```bash
git status --ignored
git ls-files | grep -E '\.wrangler|\.dev\.vars|\.sqlite'   # 何も出なければ OK
```

## Cloudflare へのデプロイ

```bash
npx wrangler login
npx wrangler d1 create test-notification-db # 表示された database_id を wrangler.jsonc に書く
npm run db:migrate:remote
npm run deploy
npm run admin:create:remote -- --username <名前> --email <メールアドレス>   # 最初の管理者を作る
```

デプロイの前に、[wrangler.jsonc](wrangler.jsonc) の `APP_URL` を公開 URL（`https://<name>.<サブドメイン>.workers.dev`）にしておいてください
（メール内のリンクと CSRF チェックに使います）。ダッシュボードで変更しても、`npm run deploy` のたびに wrangler.jsonc の値に戻ります。

> [!WARNING]
> 今のままデプロイすると、招待リンク・再設定リンク・確認コードは、メールの代わりに Workers のログに出力されます
> （ダッシュボードの Workers & Pages → Worker → Logs、または `npx wrangler tail` で確認できます）。
> ログを見られる人しかパスワードの設定やログインができないので、ほかの人に使ってもらう前に実際のメール送信に切り替えてください。

## 実際にメールを送るには

[mailer.ts](src/worker/mailer.ts) の `createMailer()` が返す実装を差し替えます。例えば Resend を使う場合は次のようになります。

```ts
class ResendMailer implements Mailer {
  constructor(private apiKey: string, private from: string) {}
  async send(mail: Mail) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text }),
    });
    // 例外を投げると outbox が failed になり、Cron で再送される
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}
```

```bash
npx wrangler secret put RESEND_API_KEY   # 本番
echo 'RESEND_API_KEY=...' >> .dev.vars    # ローカル（コミットされない）
```

ほかには、Cloudflare Email Routing の `send_email` バインディング（送信先は事前に認証したアドレスに限られる）や
SendGrid なども使えます。

## API 一覧

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/api/auth/login` | パスワードを確認し、確認コードをメールで送る `{ email, password }` |
| POST | `/api/auth/mfa` | 確認コードを検証してセッションを発行する `{ code }` |
| POST | `/api/auth/token` | 招待 / 再設定リンクの確認（消費しない） `{ token }` |
| POST | `/api/auth/password/set` | 招待 / 再設定リンクからパスワードを設定する `{ token, password }` |
| POST | `/api/auth/password/forgot` | パスワード再設定リンクを送る `{ email }` |
| POST | `/api/auth/logout` | ログアウトする |
| GET | `/api/me` | ログイン中のユーザー |
| GET | `/api/users` | 承認者の候補（承認者 / 管理者ロール、ユーザー名のみ） |
| GET | `/api/requests` | 自分の申請と、自分が承認する申請 |
| POST | `/api/requests` | 申請する `{ title, body, approverId }` → 承認者に通知 |
| POST | `/api/requests/:id/decision` | 承認 / 却下する `{ decision: "approved" \| "rejected", comment }` → 申請者に通知 |
| GET | `/api/notifications` | 自分宛ての通知メールの履歴 |
| GET | `/api/admin/users` | ユーザー一覧（管理者のみ） |
| POST | `/api/admin/users` | ユーザーを追加して招待メールを送る `{ username, email, role }`（管理者のみ） |
| PATCH | `/api/admin/users/:id` | ロール変更・無効化 / 有効化 `{ role?, disabled? }`（管理者のみ） |
| POST | `/api/admin/users/:id/invite` | 招待メールを再送する（管理者のみ） |
