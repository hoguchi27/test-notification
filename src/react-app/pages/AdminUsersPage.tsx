import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLE_LABEL, type AdminUser, type Me, type Role } from "../../shared/types";
import { api, formatDate } from "../api";
import { AppHeader } from "../AppHeader";

const ROLES = Object.keys(ROLE_LABEL) as Role[];

const STATUS_LABEL: Record<AdminUser["status"], string> = {
  invited: "招待中",
  active: "利用中",
  disabled: "無効",
};

type Props = { me: Me; onLogout: () => void };

export function AdminUsersPage({ me, onLogout }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    try {
      setUsers(await api<AdminUser[]>("/admin/users"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // 一覧の操作（ロール変更・無効化・招待の再送）は共通でエラーとメッセージを表示する
  async function act(action: () => Promise<unknown>, done: string) {
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(done);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="container">
      <AppHeader me={me} onLogout={onLogout} />
      <h2>ユーザー管理</h2>
      <AddUserForm
        onAdded={(email) => {
          setMessage(`${email} に招待メールを送りました`);
          reload();
        }}
      />

      <h2>ユーザー一覧</h2>
      {message && <p className="notice">{message}</p>}
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ユーザー名</th>
              <th>メールアドレス</th>
              <th>ロール</th>
              <th>状態</th>
              <th>追加日時</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.id === me.id;
              return (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      value={u.role}
                      disabled={isMe}
                      title={isMe ? "自分自身のロールは変更できません" : undefined}
                      onChange={(e) =>
                        act(
                          () => api(`/admin/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }),
                          `${u.username} のロールを変更しました`,
                        )
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${u.status}`}>{STATUS_LABEL[u.status]}</span>
                  </td>
                  <td className="meta">{formatDate(u.createdAt)}</td>
                  <td className="actions">
                    {u.status === "invited" && (
                      <button
                        className="secondary"
                        onClick={() => act(() => api(`/admin/users/${u.id}/invite`, { method: "POST" }), `${u.email} に招待メールを再送しました`)}
                      >
                        招待を再送
                      </button>
                    )}
                    {!isMe &&
                      (u.status === "disabled" ? (
                        <button
                          className="secondary"
                          onClick={() =>
                            act(
                              () => api(`/admin/users/${u.id}`, { method: "PATCH", body: { disabled: false } }),
                              `${u.username} を有効にしました`,
                            )
                          }
                        >
                          有効にする
                        </button>
                      ) : (
                        <button
                          className="danger"
                          onClick={() => {
                            if (!window.confirm(`${u.username} を無効にしますか？ログイン中の場合はすぐにログアウトされます。`)) return;
                            act(
                              () => api(`/admin/users/${u.id}`, { method: "PATCH", body: { disabled: true } }),
                              `${u.username} を無効にしました`,
                            );
                          }}
                        >
                          無効にする
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function AddUserForm({ onAdded }: { onAdded: (email: string) => void }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/users", { body: { username, email, role } });
      onAdded(email);
      setUsername("");
      setEmail("");
      setRole("member");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <h2>ユーザーを追加</h2>
      <label>
        ユーザー名
        <input value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={50} />
      </label>
      <label>
        メールアドレス
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
      </label>
      <label>
        ロール
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">一般: 申請のみ / 承認者: 申請と承認 / 管理者: 申請・承認・ユーザー管理</p>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "送信中..." : "追加して招待メールを送る"}
      </button>
    </form>
  );
}
