import { useEffect, useState, type FormEvent } from "react";
import type { TokenInfo } from "../../shared/types";
import { api } from "../api";

// 招待メールとパスワード再設定メールのリンク先。
// 開いただけではトークンを消費せず、パスワードを送信したときに使用済みにする
export function SetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("リンクが正しくありません。");
      return;
    }
    api<TokenInfo>("/auth/token", { body: { token } })
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("確認用のパスワードが一致しません");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/auth/password/set", { body: { token, password } });
      // トークン入りの URL を履歴に残さないよう replace する
      window.location.replace("/?password_set=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="container narrow">
      <h1>{info?.purpose === "reset" ? "パスワードの再設定" : "パスワードの設定"}</h1>
      {info && (
        <>
          <p>
            {info.username} さん（{info.email}）のパスワードを設定してください。
          </p>
          <form onSubmit={handleSubmit} className="card">
            <label>
              新しいパスワード（8 文字以上）
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            <label>
              新しいパスワード（確認）
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={busy}>
              {busy ? "設定中..." : "パスワードを設定する"}
            </button>
          </form>
        </>
      )}
      {!info && error && <p className="error">{error}</p>}
      {!info && !error && <p>確認中...</p>}
      <p>
        <a href="/">ログイン画面に戻る</a>
      </p>
    </main>
  );
}
