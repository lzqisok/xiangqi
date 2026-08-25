CREATE TABLE IF NOT EXISTS users (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  status varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  auth_epoch bigint unsigned NOT NULL DEFAULT 0,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deletion_requested_at datetime(6) NULL,
  deletion_due_at datetime(6) NULL,
  deleted_at datetime(6) NULL,
  CONSTRAINT users_status_chk CHECK (status IN (
    'pending_verification', 'active', 'restricted', 'suspended', 'pending_deletion', 'deleted'
  )),
  CONSTRAINT users_pending_deletion_chk CHECK (
    status <> 'pending_deletion'
    OR (deletion_requested_at IS NOT NULL AND deletion_due_at IS NOT NULL)
  ),
  CONSTRAINT users_deleted_chk CHECK (status <> 'deleted' OR deleted_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  display_name varchar(80) NOT NULL,
  avatar_object_key varchar(512) NULL,
  locale varchar(35) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'zh-CN',
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT user_profiles_name_chk CHECK (char_length(display_name) BETWEEN 2 AND 20),
  CONSTRAINT user_profiles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS auth_identities (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identifier_normalized varchar(320) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identifier_display varchar(320) NOT NULL,
  verified_at datetime(6) NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT auth_identities_provider_chk CHECK (provider = 'email'),
  CONSTRAINT auth_identities_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY auth_identities_identifier_uq (provider, identifier_normalized),
  UNIQUE KEY auth_identities_user_provider_uq (user_id, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS password_credentials (
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  password_hash varchar(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  hash_version int unsigned NOT NULL,
  changed_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT password_credentials_hash_chk CHECK (char_length(password_hash) BETWEEN 20 AND 1024),
  CONSTRAINT password_credentials_version_chk CHECK (hash_version > 0),
  CONSTRAINT password_credentials_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash binary(32) NOT NULL,
  auth_epoch bigint unsigned NOT NULL,
  csrf_secret_hash binary(32) NOT NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_seen_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  idle_expires_at datetime(6) NOT NULL,
  absolute_expires_at datetime(6) NOT NULL,
  revoked_at datetime(6) NULL,
  device_label varchar(100) NULL,
  last_ip_prefix varchar(45) CHARACTER SET ascii COLLATE ascii_bin NULL,
  CONSTRAINT sessions_expiry_chk CHECK (idle_expires_at <= absolute_expires_at),
  CONSTRAINT sessions_seen_chk CHECK (last_seen_at >= created_at),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY sessions_token_hash_uq (token_hash),
  KEY sessions_user_active_idx (user_id, revoked_at, absolute_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS account_tokens (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash binary(32) NOT NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at datetime(6) NOT NULL,
  used_at datetime(6) NULL,
  revoked_at datetime(6) NULL,
  active_purpose varchar(32) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (IF(used_at IS NULL AND revoked_at IS NULL, purpose, NULL)) STORED,
  CONSTRAINT account_tokens_purpose_chk CHECK (
    purpose IN ('verify_email', 'reset_password', 'recover_deletion')
  ),
  CONSTRAINT account_tokens_expiry_chk CHECK (expires_at > created_at),
  CONSTRAINT account_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY account_tokens_hash_uq (token_hash),
  UNIQUE KEY account_tokens_active_purpose_uq (user_id, active_purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS security_events (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  session_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  type varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ip_prefix varchar(45) CHARACTER SET ascii COLLATE ascii_bin NULL,
  user_agent_summary varchar(200) NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  metadata json NOT NULL DEFAULT (JSON_OBJECT()),
  CONSTRAINT security_events_metadata_chk CHECK (JSON_TYPE(metadata) = 'OBJECT'),
  CONSTRAINT security_events_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT security_events_session_fk FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
  KEY security_events_created_idx (created_at),
  KEY security_events_user_idx (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
