-- 時刻はすべて UNIX エポックミリ秒 (INTEGER)

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- ワンタイムログインリンク。トークン本体は保存せず SHA-256 ハッシュだけを持つ
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  username   TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

-- セッション。Cookie の値は保存せず SHA-256 ハッシュだけを持つ
CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE requests (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  applicant_id TEXT NOT NULL REFERENCES users(id),
  approver_id  TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  comment      TEXT,
  created_at   INTEGER NOT NULL,
  decided_at   INTEGER
);
CREATE INDEX idx_requests_applicant ON requests(applicant_id);
CREATE INDEX idx_requests_approver ON requests(approver_id, status);

-- 通知メールの送信キュー兼履歴（Transactional Outbox）
CREATE TABLE outbox (
  id          TEXT PRIMARY KEY,
  to_user_id  TEXT NOT NULL REFERENCES users(id),
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER
);
CREATE INDEX idx_outbox_status ON outbox(status, created_at);
CREATE INDEX idx_outbox_to_user ON outbox(to_user_id, created_at);
