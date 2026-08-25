#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_BACKUP_URL:?DATABASE_BACKUP_URL is required}"
: "${DATABASE_BACKUP_DIR:?DATABASE_BACKUP_DIR is required}"

case "$DATABASE_BACKUP_DIR" in
  /|"$HOME"|"")
    echo "DATABASE_BACKUP_DIR must be a dedicated directory" >&2
    exit 2
    ;;
esac

mkdir -p "$DATABASE_BACKUP_DIR"
options_file="$(mktemp)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$DATABASE_BACKUP_DIR/xiangqi-$timestamp.sql.gz"
temporary="$target.partial"
trap 'rm -f "$options_file" "$temporary"' EXIT

database_name="$(DATABASE_TOOL_URL="$DATABASE_BACKUP_URL" node scripts/mysql-url-options.mjs "$options_file")"
mysqldump \
  --defaults-extra-file="$options_file" \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  --set-gtid-purged=OFF \
  "$database_name" | gzip -9 >"$temporary"
gzip -t "$temporary"
mv "$temporary" "$target"
shasum -a 256 "$target" >"$target.sha256"
rm -f "$options_file"
trap - EXIT

echo "$target"
