CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_hash binary(32) NOT NULL PRIMARY KEY,
  scope varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  window_started_at datetime(6) NOT NULL,
  expires_at datetime(6) NOT NULL,
  request_count int unsigned NOT NULL DEFAULT 1,
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT rate_limit_buckets_count_chk CHECK (request_count > 0),
  CONSTRAINT rate_limit_buckets_expiry_chk CHECK (expires_at > window_started_at),
  KEY rate_limit_buckets_expiry_idx (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
