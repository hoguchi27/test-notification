import { useState } from "react";
import { api } from "../api";

// メールのリンク先。開いただけではログインせず、ボタンを押したときにトークンを POST する
// （メールのセキュリティスキャナがリンクを先に開いても、トークンが消費されないようにするため）
export function VerifyPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/verify", { body: { token } });
      // トークン入りの URL を履歴に残さないよう replace する
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="container narrow">
      <h1>ログイン</h1>
      {token ? (
        <>
          <p>下のボタンを押してログインを完了してください。</p>
          <button onClick={handleLogin} disabled={busy}>
            {busy ? "確認中..." : "ログインする"}
          </button>
        </>
      ) : (
        <p className="error">リンクが正しくありません。</p>
      )}
      {error && <p className="error">{error}</p>}
      <p>
        <a href="/">ログイン画面に戻る</a>
      </p>
    </main>
  );
}
