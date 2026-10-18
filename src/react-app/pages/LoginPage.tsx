import { useState, type FormEvent } from "react";
import { api } from "../api";

type Props = { onLoggedIn: () => void };

// 1. メールアドレスとパスワード → 2. メールで届いた 6 桁のコード の 2 段階でログインする
export function LoginPage({ onLoggedIn }: Props) {
  const [step, setStep] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordSet = new URLSearchParams(window.location.search).has("password_set");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handlePassword(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await api("/auth/login", { body: { email, password } });
      setPassword("");
      setStep("code");
    });
  }

  function handleCode(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await api("/auth/mfa", { body: { code } });
      window.history.replaceState(null, "", "/");
      onLoggedIn();
    });
  }

  if (step === "code") {
    return (
      <main className="container narrow">
        <h1>ログイン確認コード</h1>
        <p>
          <strong>{email}</strong> 宛てに 6 桁の確認コードを送りました。10 分以内に入力してください。
        </p>
        <p className="hint">
          このサンプルでは実際にはメールを送りません。ローカルでは <code>npm run dev</code> のターミナルに、
          Cloudflare 上では Workers のログに出力されます。
        </p>
        <form onSubmit={handleCode} className="card">
          <label>
            確認コード
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "確認中..." : "ログイン"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setStep("password");
              setCode("");
              setError("");
            }}
          >
            最初からやり直す
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="container narrow">
      <h1>承認通知サンプル</h1>
      {passwordSet && <p className="notice">パスワードを設定しました。新しいパスワードでログインしてください。</p>}
      <form onSubmit={handlePassword} className="card">
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" />
        </label>
        <label>
          パスワード
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={128}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "確認中..." : "次へ"}
        </button>
      </form>
      <p>
        <a href="/forgot-password">パスワードを忘れた場合</a>
      </p>
      <p className="hint">アカウントは管理者が追加します。招待メールのリンクからパスワードを設定してください。</p>
    </main>
  );
}
