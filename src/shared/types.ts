// フロントエンドと Worker で共有する API の型

export type RequestStatus = "pending" | "approved" | "rejected";

// member: 申請のみ / approver: 申請と承認 / admin: 申請・承認・ユーザー管理
export type Role = "member" | "approver" | "admin";

export const ROLE_LABEL: Record<Role, string> = {
  member: "一般",
  approver: "承認者",
  admin: "管理者",
};

export function canApprove(role: Role): boolean {
  return role === "approver" || role === "admin";
}

export type Me = {
  id: string;
  username: string;
  email: string;
  role: Role;
};

// 管理画面のユーザー一覧
export type AdminUser = {
  id: string;
  username: string;
  email: string;
  role: Role;
  // invited: 招待済みでパスワード未設定 / active: 利用中 / disabled: 無効
  status: "invited" | "active" | "disabled";
  createdAt: number;
};

// 招待リンク・パスワード再設定リンクの確認結果
export type TokenInfo = {
  purpose: "invite" | "reset";
  username: string;
  email: string;
};

// 他のユーザーには username だけを見せる（メールアドレスは返さない）
export type UserSummary = {
  id: string;
  username: string;
};

export type ApprovalRequest = {
  id: string;
  title: string;
  body: string;
  status: RequestStatus;
  comment: string | null;
  applicantName: string;
  approverName: string;
  createdAt: number;
  decidedAt: number | null;
};

export type RequestsResponse = {
  mine: ApprovalRequest[];
  toApprove: ApprovalRequest[];
};

export type Notification = {
  id: string;
  subject: string;
  body: string;
  status: "pending" | "sent" | "failed";
  createdAt: number;
  sentAt: number | null;
};
