// フロントエンドと Worker で共有する API の型

export type RequestStatus = "pending" | "approved" | "rejected";

export type Me = {
  id: string;
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
