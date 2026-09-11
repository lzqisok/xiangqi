CREATE TABLE IF NOT EXISTS matchmaking_cancellation_limits (
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  window_started_at datetime(6) NOT NULL,
  cancellation_count int unsigned NOT NULL,
  blocked_until datetime(6) NULL,
  CONSTRAINT matchmaking_cancellation_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
