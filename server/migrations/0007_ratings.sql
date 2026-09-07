CREATE TABLE IF NOT EXISTS user_ratings (
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pool_key varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rating int unsigned NOT NULL DEFAULT 1500,
  games_played int unsigned NOT NULL DEFAULT 0,
  wins int unsigned NOT NULL DEFAULT 0,
  draws int unsigned NOT NULL DEFAULT 0,
  losses int unsigned NOT NULL DEFAULT 0,
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, pool_key),
  CONSTRAINT user_ratings_pool_chk CHECK (
    pool_key IN ('xiangqi', 'jieqi', 'gomoku-freestyle', 'gomoku-renju')
  ),
  CONSTRAINT user_ratings_rating_chk CHECK (rating >= 100),
  CONSTRAINT user_ratings_games_chk CHECK (games_played = wins + draws + losses),
  CONSTRAINT user_ratings_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY user_ratings_leaderboard_idx (pool_key, rating DESC, games_played DESC, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS match_rating_settlements (
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  pool_key varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  model varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  red_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  black_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  result varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  k_factor int unsigned NOT NULL,
  red_rating_before int unsigned NOT NULL,
  red_rating_after int unsigned NOT NULL,
  black_rating_before int unsigned NOT NULL,
  black_rating_after int unsigned NOT NULL,
  settled_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  voided_at datetime(6) NULL,
  void_reason varchar(200) NULL,
  CONSTRAINT match_rating_settlements_pool_chk CHECK (
    pool_key IN ('xiangqi', 'jieqi', 'gomoku-freestyle', 'gomoku-renju')
  ),
  CONSTRAINT match_rating_settlements_model_chk CHECK (model = 'elo-v1'),
  CONSTRAINT match_rating_settlements_result_chk CHECK (result IN ('red-wins', 'black-wins', 'draw')),
  CONSTRAINT match_rating_settlements_k_chk CHECK (k_factor IN (24, 40)),
  CONSTRAINT match_rating_settlements_void_chk CHECK (
    (voided_at IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND char_length(void_reason) BETWEEN 1 AND 200)
  ),
  CONSTRAINT match_rating_settlements_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  CONSTRAINT match_rating_settlements_red_fk FOREIGN KEY (red_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT match_rating_settlements_black_fk FOREIGN KEY (black_user_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY match_rating_settlements_red_idx (red_user_id, settled_at DESC),
  KEY match_rating_settlements_black_idx (black_user_id, settled_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rating_ledger (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  pool_key varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  entry_type varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rating_before int unsigned NOT NULL,
  rating_after int unsigned NOT NULL,
  delta int NOT NULL,
  reason varchar(200) NOT NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT rating_ledger_pool_chk CHECK (
    pool_key IN ('xiangqi', 'jieqi', 'gomoku-freestyle', 'gomoku-renju')
  ),
  CONSTRAINT rating_ledger_type_chk CHECK (entry_type IN ('settlement', 'void')),
  CONSTRAINT rating_ledger_delta_chk CHECK (rating_after = rating_before + delta),
  CONSTRAINT rating_ledger_match_fk FOREIGN KEY (match_id) REFERENCES match_rating_settlements(match_id) ON DELETE CASCADE,
  CONSTRAINT rating_ledger_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY rating_ledger_once_uq (match_id, user_id, entry_type),
  KEY rating_ledger_user_idx (user_id, pool_key, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
