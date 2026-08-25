CREATE TABLE IF NOT EXISTS matches (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  variant varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  gomoku_rule varchar(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  matchmaking boolean NOT NULL DEFAULT false,
  visibility varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  phase varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status_reason varchar(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  revision bigint unsigned NOT NULL DEFAULT 0,
  previous_match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_by_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  started_at datetime(6) NULL,
  finished_at datetime(6) NULL,
  expires_at datetime(6) NOT NULL,
  CONSTRAINT matches_variant_chk CHECK (variant IN ('xiangqi', 'jieqi', 'gomoku')),
  CONSTRAINT matches_visibility_chk CHECK (visibility IN ('public', 'invite', 'private')),
  CONSTRAINT matches_phase_chk CHECK (phase IN ('waiting', 'playing', 'finished')),
  CONSTRAINT matches_status_chk CHECK (status IN ('playing', 'red-wins', 'black-wins', 'draw')),
  CONSTRAINT matches_reason_chk CHECK (status_reason IS NULL OR status_reason IN (
    'checkmate', 'stalemate', 'resignation', 'agreement', 'repetition', 'natural-limit',
    'move-limit', 'disconnect', 'abandoned', 'five', 'forbidden', 'full-board'
  )),
  CONSTRAINT matches_gomoku_rule_chk CHECK (
    (variant = 'gomoku' AND gomoku_rule IN ('freestyle', 'renju'))
    OR (variant <> 'gomoku' AND gomoku_rule IS NULL)
  ),
  CONSTRAINT matches_phase_status_chk CHECK ((phase = 'finished') = (status <> 'playing')),
  CONSTRAINT matches_finished_start_chk CHECK (finished_at IS NULL OR started_at IS NOT NULL),
  CONSTRAINT matches_finished_order_chk CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT matches_previous_fk FOREIGN KEY (previous_match_id) REFERENCES matches(id) ON DELETE SET NULL,
  CONSTRAINT matches_creator_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY matches_lobby_idx (phase, visibility, variant, created_at DESC),
  KEY matches_finished_idx (finished_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS match_participants (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  side varchar(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  is_owner boolean NOT NULL DEFAULT false,
  display_name_snapshot varchar(80) NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  hints_used smallint unsigned NOT NULL DEFAULT 0,
  joined_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  left_at datetime(6) NULL,
  anonymized_at datetime(6) NULL,
  active_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (IF(left_at IS NULL, user_id, NULL)) STORED,
  active_side varchar(8) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (IF(left_at IS NULL, side, NULL)) STORED,
  active_owner tinyint
    GENERATED ALWAYS AS (IF(is_owner AND left_at IS NULL, 1, NULL)) STORED,
  CONSTRAINT match_participants_side_chk CHECK (side IS NULL OR side IN ('red', 'black')),
  CONSTRAINT match_participants_name_chk CHECK (char_length(display_name_snapshot) BETWEEN 2 AND 20),
  CONSTRAINT match_participants_hints_chk CHECK (hints_used BETWEEN 0 AND 3),
  CONSTRAINT match_participants_left_chk CHECK (left_at IS NULL OR left_at >= joined_at),
  CONSTRAINT match_participants_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  CONSTRAINT match_participants_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE KEY match_participants_active_user_uq (match_id, active_user_id),
  UNIQUE KEY match_participants_active_side_uq (match_id, active_side),
  UNIQUE KEY match_participants_owner_uq (match_id, active_owner),
  KEY match_participants_user_history_idx (user_id, match_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS match_states (
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  schema_version int unsigned NOT NULL,
  revision bigint unsigned NOT NULL,
  public_state json NOT NULL,
  referee_state json NOT NULL,
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT match_states_schema_version_chk CHECK (schema_version > 0),
  CONSTRAINT match_states_public_chk CHECK (JSON_TYPE(public_state) = 'OBJECT'),
  CONSTRAINT match_states_referee_chk CHECK (JSON_TYPE(referee_state) = 'OBJECT'),
  CONSTRAINT match_states_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS match_invites (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  token_hash binary(32) NOT NULL,
  allowed_side varchar(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  expires_at datetime(6) NOT NULL,
  used_by_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  used_at datetime(6) NULL,
  revoked_at datetime(6) NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT match_invites_side_chk CHECK (allowed_side IS NULL OR allowed_side IN ('red', 'black')),
  CONSTRAINT match_invites_expiry_chk CHECK (expires_at > created_at),
  CONSTRAINT match_invites_usage_chk CHECK (used_by_user_id IS NULL OR used_at IS NOT NULL),
  CONSTRAINT match_invites_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  CONSTRAINT match_invites_creator_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT match_invites_used_by_fk FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE KEY match_invites_hash_uq (token_hash),
  KEY match_invites_expiry_idx (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
