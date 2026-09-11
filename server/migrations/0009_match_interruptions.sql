CREATE TABLE IF NOT EXISTS match_interruptions (
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  source varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operator_name varchar(100) NOT NULL,
  reason varchar(200) NOT NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT match_interruptions_source_chk CHECK (source IN ('service_restart', 'service_failure', 'admin_abort')),
  CONSTRAINT match_interruptions_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
