CREATE TABLE IF NOT EXISTS user_documents (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  owner_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_type varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  schema_version int unsigned NOT NULL,
  revision bigint unsigned NOT NULL DEFAULT 0,
  payload json NOT NULL,
  client_mutation_id varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  logical_key varchar(512) NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT user_documents_schema_chk CHECK (schema_version > 0),
  CONSTRAINT user_documents_payload_chk CHECK (JSON_TYPE(payload) = 'OBJECT'),
  CONSTRAINT user_documents_owner_fk
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY user_documents_owner_resource_id_uq (owner_user_id, resource_type, id),
  UNIQUE KEY user_documents_owner_resource_logical_uq
    (owner_user_id, resource_type, logical_key),
  KEY user_documents_owner_resource_updated_idx
    (owner_user_id, resource_type, updated_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_document_mutations (
  owner_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_type varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  client_mutation_id varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_revision bigint unsigned NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (owner_user_id, resource_type, client_mutation_id),
  CONSTRAINT user_document_mutations_operation_chk
    CHECK (operation IN ('create', 'update', 'delete')),
  CONSTRAINT user_document_mutations_owner_fk
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY user_document_mutations_created_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
