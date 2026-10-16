import { useState, type FormEvent } from "react";
import { api } from "../api";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/request", { body: { username, email } });
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <main className="container narrow">
        <h1>メールを確認してください</h1>
        <p>
          <strong>{sentTo}</strong> 宛てにログイン用リンクを送りました。リンクは 15 分間有効です。
        </p>
        <p className="hint">
          このサンプルでは実際にはメールを送りません。<code>npm run dev</code> を実行しているターミナルに
          出力されたリンクを開いてください。
        </p>
        <button className="secondary" onClick={() => setSentTo("")}>
          戻る
        </button>
      </main>
    );
  }

  return (
    <main className="container narrow">
      <h1>承認通知サンプル</h1>
      <p>ユーザー名とメールアドレスを入力してください。初めての場合は、そのまま登録されます。</p>
      <form onSubmit={handleSubmit} className="card">
        <label>
          ユーザー名
          <input value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={50} autoComplete="nickname" />
        </label>
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "送信中..." : "ログインリンクを送る"}
        </button>
      </form>
    </main>
  );
}
