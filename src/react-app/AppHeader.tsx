import { ROLE_LABEL, type Me } from "../shared/types";
import { api } from "./api";

type Props = { me: Me; onLogout: () => void };

export function AppHeader({ me, onLogout }: Props) {
  async function handleLogout() {
    await api("/auth/logout", { method: "POST" });
    window.history.replaceState(null, "", "/");
    onLogout();
  }

  return (
    <header className="header">
      <h1>
        <a href="/" className="title-link">
          承認通知サンプル
        </a>
      </h1>
      <div className="header-actions">
        {me.role === "admin" && <a href="/admin">ユーザー管理</a>}
        <span className="me">
          {me.username}（{ROLE_LABEL[me.role]}）
        </span>
        <button className="secondary" onClick={handleLogout}>
          ログアウト
        </button>
      </div>
    </header>
  );
}
