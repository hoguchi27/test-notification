-- 管理者によるユーザー追加（招待）、パスワードログイン、メールでの多要素認証に切り替える

-- member: 申請のみ / approver: 申請と承認 / admin: 申請・承認・ユーザー管理
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'approver', 'admin'));
-- PBKDF2 のハッシュ。招待されてまだパスワードを設定していないユーザーは NULL
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN disabled_at INTEGER;
-- パスワードの総当たり対策。連続で失敗すると一定時間ロックする
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until INTEGER;

-- ワンタイムログインリンクは使わなくなった
DROP TABLE login_tokens;

-- 招待リンクとパスワード再設定リンク。トークン本体は保存せず SHA-256 ハッシュだけを持つ
CREATE TABLE user_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  purpose    TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_user_tokens_user ON user_tokens(user_id, purpose);

-- ログイン時の 6 桁コード。パスワードが正しかったときに作り、ID は Cookie で渡す
CREATE TABLE mfa_challenges (
  id_hash    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
