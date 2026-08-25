ALTER TABLE matches
  ADD COLUMN competition_mode varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'casual' AFTER matchmaking,
  ADD COLUMN clock_preset varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'none' AFTER competition_mode,
  ADD CONSTRAINT matches_competition_mode_chk CHECK (competition_mode IN ('casual', 'rated')),
  ADD CONSTRAINT matches_clock_preset_chk CHECK (clock_preset IN ('none', '10m', '15m-10s', '30m'));

ALTER TABLE match_participants
  ADD COLUMN disconnected_at datetime(6) NULL AFTER anonymized_at,
  ADD COLUMN disconnect_deadline datetime(6) NULL AFTER disconnected_at,
  ADD CONSTRAINT match_participants_disconnect_chk CHECK (
    (disconnected_at IS NULL AND disconnect_deadline IS NULL)
    OR (disconnected_at IS NOT NULL AND disconnect_deadline >= disconnected_at)
  );

CREATE TABLE IF NOT EXISTS matchmaking_entries (
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  variant varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  gomoku_rule varchar(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  competition_mode varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  clock_preset varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at datetime(6) NOT NULL,
  CONSTRAINT matchmaking_entries_variant_chk CHECK (variant IN ('xiangqi', 'jieqi', 'gomoku')),
  CONSTRAINT matchmaking_entries_gomoku_rule_chk CHECK (
    (variant = 'gomoku' AND gomoku_rule IN ('freestyle', 'renju'))
    OR (variant <> 'gomoku' AND gomoku_rule IS NULL)
  ),
  CONSTRAINT matchmaking_entries_mode_chk CHECK (competition_mode IN ('casual', 'rated')),
  CONSTRAINT matchmaking_entries_clock_chk CHECK (clock_preset IN ('none', '10m', '15m-10s', '30m')),
  CONSTRAINT matchmaking_entries_expiry_chk CHECK (expires_at > created_at),
  CONSTRAINT matchmaking_entries_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT matchmaking_entries_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  UNIQUE KEY matchmaking_entries_match_uq (match_id),
  UNIQUE KEY matchmaking_entries_request_uq (user_id, request_key),
  KEY matchmaking_entries_candidate_idx (
    variant, gomoku_rule, competition_mode, clock_preset, created_at
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS matchmaking_partitions (
  partition_key varchar(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS matchmaking_requests (
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_key char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, request_key),
  CONSTRAINT matchmaking_requests_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT matchmaking_requests_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  KEY matchmaking_requests_match_idx (match_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS match_commands (
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  command_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  command_type varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_revision bigint unsigned NOT NULL,
  result_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (match_id, user_id, command_id),
  CONSTRAINT match_commands_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  CONSTRAINT match_commands_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY match_commands_created_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS match_proposals (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  proposed_by_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  deadline datetime(6) NOT NULL,
  resolved_by_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  resolved_at datetime(6) NULL,
  active_kind varchar(16) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (IF(status = 'pending', kind, NULL)) STORED,
  CONSTRAINT match_proposals_kind_chk CHECK (kind IN ('undo', 'draw', 'swap')),
  CONSTRAINT match_proposals_status_chk CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'expired')),
  CONSTRAINT match_proposals_deadline_chk CHECK (deadline > created_at),
  CONSTRAINT match_proposals_resolution_chk CHECK (
    (status = 'pending' AND resolved_at IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT match_proposals_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  CONSTRAINT match_proposals_author_fk FOREIGN KEY (proposed_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT match_proposals_resolver_fk FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY match_proposals_active_kind_uq (match_id, active_kind),
  KEY match_proposals_deadline_idx (status, deadline)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS match_chat_settings (
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  everyone_muted boolean NOT NULL DEFAULT false,
  next_sequence bigint unsigned NOT NULL DEFAULT 1,
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT match_chat_settings_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS match_chat_mutes (
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  muted_by_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (match_id, user_id),
  CONSTRAINT match_chat_mutes_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  CONSTRAINT match_chat_mutes_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT match_chat_mutes_moderator_fk FOREIGN KEY (muted_by_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS match_chat_messages (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  match_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sequence bigint unsigned NOT NULL,
  author_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  display_name_snapshot varchar(80) NOT NULL,
  role_snapshot varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content varchar(800) NULL,
  moderation_state varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'visible',
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at datetime(6) NULL,
  deletion_reason varchar(80) NULL,
  CONSTRAINT match_chat_messages_role_chk CHECK (role_snapshot IN ('owner', 'red', 'black', 'spectator')),
  CONSTRAINT match_chat_messages_state_chk CHECK (moderation_state IN ('visible', 'deleted', 'flagged')),
  CONSTRAINT match_chat_messages_content_chk CHECK (
    (moderation_state = 'deleted' AND content IS NULL AND deleted_at IS NOT NULL)
    OR (moderation_state <> 'deleted' AND char_length(content) BETWEEN 1 AND 200)
  ),
  CONSTRAINT match_chat_messages_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  CONSTRAINT match_chat_messages_author_fk FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY match_chat_messages_sequence_uq (match_id, sequence),
  KEY match_chat_messages_created_idx (match_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
