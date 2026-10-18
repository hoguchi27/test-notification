import { useState, type FormEvent } from "react";
import { api } from "../api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/password/forgot", { body: { email } });
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container narrow">
      <h1>パスワードの再設定</h1>
      {sentTo ? (
        // 登録されているかどうかは表示しない（メールアドレスの存在確認に使われないように）
        <p>
          <strong>{sentTo}</strong> が登録されている場合は、パスワード再設定用のリンクを送りました。リンクは 30 分間有効です。
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="card">
          <label>
            登録しているメールアドレス
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "送信中..." : "再設定リンクを送る"}
          </button>
        </form>
      )}
      <p>
        <a href="/">ログイン画面に戻る</a>
      </p>
    </main>
  );
}
