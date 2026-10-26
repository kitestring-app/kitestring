CREATE TABLE IF NOT EXISTS kv (
  email TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (email, key)
);
CREATE TABLE users (email TEXT PRIMARY KEY, pw_hash TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, device_label TEXT NOT NULL);
CREATE INDEX sessions_email ON sessions(email);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL);
