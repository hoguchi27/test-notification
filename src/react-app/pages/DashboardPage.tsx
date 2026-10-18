import { useCallback, useEffect, useState, type FormEvent } from "react";
import { canApprove, type ApprovalRequest, type Me, type Notification, type RequestsResponse, type RequestStatus, type UserSummary } from "../../shared/types";
import { api, formatDate } from "../api";
import { AppHeader } from "../AppHeader";

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
};

type Props = { me: Me; onLogout: () => void };

export function DashboardPage({ me, onLogout }: Props) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [requests, setRequests] = useState<RequestsResponse>({ mine: [], toApprove: [] });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [u, r, n] = await Promise.all([
        api<UserSummary[]>("/users"),
        api<RequestsResponse>("/requests"),
        api<Notification[]>("/notifications"),
      ]);
      setUsers(u);
      setRequests(r);
      setNotifications(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <main className="container">
      <AppHeader me={me} onLogout={onLogout} />
      {error && <p className="error">{error}</p>}

      <div className="grid">
        <section>
          <NewRequestForm users={users} onCreated={reload} />
          <h2>あなたの申請</h2>
          <RequestList items={requests.mine} empty="まだ申請はありません" />
        </section>

        <section>
          {canApprove(me.role) && (
            <>
              <h2>あなたが承認する申請</h2>
              <RequestList items={requests.toApprove} empty="承認依頼はありません" onDecided={reload} />
            </>
          )}
          <h2>あなた宛ての通知メール</h2>
          <NotificationList items={notifications} />
        </section>
      </div>
    </main>
  );
}

function NewRequestForm({ users, onCreated }: { users: UserSummary[]; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [approverId, setApproverId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/requests", { body: { title, body, approverId } });
      setTitle("");
      setBody("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <h2>新しい申請</h2>
      <label>
        件名
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={100} />
      </label>
      <label>
        内容
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} />
      </label>
      <label>
        承認者
        <select value={approverId} onChange={(e) => setApproverId(e.target.value)} required>
          <option value="">選択してください</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </select>
      </label>
      {users.length === 0 && (
        <p className="hint">選べる承認者がいません。管理者に、承認者ロールのユーザーの追加を依頼してください。</p>
      )}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "送信中..." : "申請する（承認者に通知）"}
      </button>
    </form>
  );
}

function RequestList({ items, empty, onDecided }: { items: ApprovalRequest[]; empty: string; onDecided?: () => void }) {
  if (items.length === 0) return <p className="hint">{empty}</p>;
  return (
    <ul className="list">
      {items.map((r) => (
        <li key={r.id} className="card">
          <div className="row">
            <strong>{r.title}</strong>
            <span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>
          </div>
          {r.body && <p className="body">{r.body}</p>}
          <p className="meta">
            申請者: {r.applicantName} / 承認者: {r.approverName} / {formatDate(r.createdAt)}
          </p>
          {r.comment && <p className="body">コメント: {r.comment}</p>}
          {onDecided && r.status === "pending" && <DecisionForm id={r.id} onDecided={onDecided} />}
        </li>
      ))}
    </ul>
  );
}

function DecisionForm({ id, onDecided }: { id: string; onDecided: () => void }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError("");
    try {
      await api(`/requests/${id}/decision`, { body: { decision, comment } });
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="decision">
      <input placeholder="コメント（任意）" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
      <button onClick={() => decide("approved")} disabled={busy}>
        承認
      </button>
      <button className="danger" onClick={() => decide("rejected")} disabled={busy}>
        却下
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function NotificationList({ items }: { items: Notification[] }) {
  if (items.length === 0) return <p className="hint">通知はまだありません</p>;
  return (
    <ul className="list">
      {items.map((n) => (
        <li key={n.id} className="card">
          <details>
            <summary>
              <strong>{n.subject}</strong>{" "}
              <span className="meta">
                {formatDate(n.createdAt)} / {n.status}
              </span>
            </summary>
            <pre className="mail">{n.body}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}
