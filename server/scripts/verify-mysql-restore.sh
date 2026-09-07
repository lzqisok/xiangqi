#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_RESTORE_URL:?DATABASE_RESTORE_URL is required}"
: "${DATABASE_BACKUP_FILE:?DATABASE_BACKUP_FILE is required}"
: "${ALLOW_RESTORE_VERIFY:?Set ALLOW_RESTORE_VERIFY=1 for an isolated restore database}"

if [[ "$ALLOW_RESTORE_VERIFY" != "1" ]]; then
  echo "ALLOW_RESTORE_VERIFY must equal 1" >&2
  exit 2
fi

options_file="$(mktemp)"
trap 'rm -f "$options_file"' EXIT
database_name="$(DATABASE_TOOL_URL="$DATABASE_RESTORE_URL" node scripts/mysql-url-options.mjs "$options_file")"
case "$database_name" in
  *test*|*restore*) ;;
  *)
    echo "Restore verification requires a database name containing test or restore" >&2
    exit 2
    ;;
esac

table_count="$(mysql --defaults-extra-file="$options_file" --batch --skip-column-names "$database_name" \
  -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()")"
if [[ "$table_count" != "0" ]]; then
  echo "Restore verification database must be empty" >&2
  exit 2
fi

gzip -t "$DATABASE_BACKUP_FILE"
gzip -dc "$DATABASE_BACKUP_FILE" | mysql --defaults-extra-file="$options_file" "$database_name"

DATABASE_URL="$DATABASE_RESTORE_URL" \
ONLINE_DATABASE_ENABLED=true \
NODE_ENV=development \
DATABASE_SSL_MODE="${DATABASE_SSL_MODE:-disable}" \
pnpm --filter server db:check

DATABASE_URL="$DATABASE_RESTORE_URL" \
ONLINE_DATABASE_ENABLED=true \
NODE_ENV=development \
DATABASE_SSL_MODE="${DATABASE_SSL_MODE:-disable}" \
pnpm exec tsx src/db/restore-verify-cli.ts

rm -f "$options_file"
trap - EXIT
