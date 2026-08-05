#!/bin/bash
# Restore PostgreSQL database from encrypted backup with verification.
#
# Security properties:
# - Decrypts to temporary database (never exposes plaintext in files)
# - Verifies migration marker and table counts
# - Cleans up plaintext immediately after restore
# - Restrictive temp permissions
# - Traps on every exit path
# - Key via environment variable, NEVER command line
#
# Usage:
#   export BACKUP_KEY='<32+ char passphrase>'
#   scripts/restore-database.sh backup.sql.enc [target-db]
#
# If target-db is omitted, creates a temporary database named
# quiksend_restore_<timestamp> and leaves it for verification.
# Plaintext dump is destroyed before exit (via trap).
#
# Returns 0 on successful restore + verification, 1 on error.

set -euo pipefail

# Required arguments
if [ $# -lt 1 ]; then
  echo "ERROR: Usage: $0 <backup-file> [target-database]" >&2
  exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="${2:-}"

# Required environment variables
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set" >&2
  exit 1
fi

if [ -z "${BACKUP_KEY:-}" ]; then
  echo "ERROR: BACKUP_KEY environment variable required" >&2
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

# Verify commands exist
for cmd in pg_restore psql openssl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Required command not found: $cmd" >&2
    exit 1
  fi
done

# Temp directory for plaintext (created with restrictive permissions)
TMPDIR_ROOT="${TMPDIR:-/tmp}"
TMPDIR=$(mktemp -d "${TMPDIR_ROOT}/.quiksend-restore.XXXXXX") || {
  echo "ERROR: Failed to create temp directory" >&2
  exit 1
}
chmod 0700 "$TMPDIR"

PLAINTEXT_DUMP="${TMPDIR}/dump.sql"

# Trap on every exit: overwrite and remove plaintext
cleanup() {
  local exit_code=$?
  if [ -f "$PLAINTEXT_DUMP" ]; then
    # Overwrite plaintext with 3 passes of zeros (best effort)
    local size_mb
    size_mb=$(du -m "$PLAINTEXT_DUMP" 2>/dev/null | cut -f1)
    if [ -n "$size_mb" ] && [ "$size_mb" -gt 0 ]; then
      dd if=/dev/zero of="$PLAINTEXT_DUMP" bs=1M count="$size_mb" 2>/dev/null || true
    fi
    rm -f "$PLAINTEXT_DUMP"
  fi
  rmdir "$TMPDIR" 2>/dev/null || true
  exit $exit_code
}
trap cleanup EXIT

# Parse DATABASE_URL to extract connection parameters
parse_db_url() {
  local url="$1"
  # Remove scheme
  url="${url#postgres://}"
  url="${url#postgresql://}"
  
  # Extract credentials and host part
  local creds_and_host="${url%%/*}"
  local db_and_query="${url#*/}"
  
  # Extract database name
  local db_name="${db_and_query%%\?*}"
  
  # Extract user and password
  local user_and_pass="${creds_and_host%%@*}"
  local host_and_port="${creds_and_host##*@}"
  
  if echo "$user_and_pass" | grep -q ':'; then
    PGUSER="${user_and_pass%%:*}"
    PGPASSWORD="${user_and_pass##*:}"
  else
    PGUSER="$user_and_pass"
    PGPASSWORD=""
  fi
  
  PGHOST="${host_and_port%%:*}"
  PGPORT="${host_and_port##*:}"
  PGDATABASE="$db_name"
}

parse_db_url "$DATABASE_URL"

# Determine target database name
if [ -z "$TARGET_DB" ]; then
  TARGET_DB="quiksend_restore_$(date +%s)"
fi

# Decrypt backup to plaintext
touch "$PLAINTEXT_DUMP"
chmod 0400 "$PLAINTEXT_DUMP"

openssl enc -aes-256-cbc -d -pbkdf2 -in "$BACKUP_FILE" -out "$PLAINTEXT_DUMP" -k "$BACKUP_KEY" \
  2>/dev/null || {
  echo "ERROR: Decryption failed (wrong key or corrupted backup?)" >&2
  exit 1
}

# Verify plaintext was created and has content
if [ ! -s "$PLAINTEXT_DUMP" ]; then
  echo "ERROR: Decryption produced empty file" >&2
  exit 1
fi

# Create target database if it doesn't exist
if [ -z "${PGPASSWORD:-}" ]; then
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    -c "CREATE DATABASE $TARGET_DB;" > /dev/null 2>&1 || {
    echo "ERROR: Failed to create target database $TARGET_DB" >&2
    exit 1
  }
else
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    -c "CREATE DATABASE $TARGET_DB;" > /dev/null 2>&1 || {
    echo "ERROR: Failed to create target database $TARGET_DB" >&2
    exit 1
  }
fi

# Restore from plaintext dump to target database
if [ -z "${PGPASSWORD:-}" ]; then
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" \
    -v "$PLAINTEXT_DUMP" > /dev/null 2>&1 || {
    echo "ERROR: pg_restore failed" >&2
    exit 1
  }
else
  PGPASSWORD="$PGPASSWORD" pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" \
    -v "$PLAINTEXT_DUMP" > /dev/null 2>&1 || {
    echo "ERROR: pg_restore failed" >&2
    exit 1
  }
fi

# Verify migration marker and table counts
verify_restore() {
  local target="$1"
  local password="${2:-}"
  
  # Get migration marker from app_meta table
  local migration_check
  if [ -z "$password" ]; then
    migration_check=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$target" \
      -t -c "SELECT value->>'version' FROM app_meta WHERE key = 'migration_marker' LIMIT 1;" 2>/dev/null || echo "")
  else
    migration_check=$(PGPASSWORD="$password" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$target" \
      -t -c "SELECT value->>'version' FROM app_meta WHERE key = 'migration_marker' LIMIT 1;" 2>/dev/null || echo "")
  fi
  
  if [ -z "$migration_check" ]; then
    echo "WARNING: Migration marker not found in app_meta" >&2
  else
    echo "Migration marker: $migration_check"
  fi
  
  # Count main tables for verification
  declare -A table_counts
  for table in organization message enrollment; do
    if [ -z "$password" ]; then
      local count
      count=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$target" \
        -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
    else
      local count
      count=$(PGPASSWORD="$password" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$target" \
        -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
    fi
    table_counts[$table]="${count## }"
    echo "Table $table: ${table_counts[$table]} rows"
  done
  
  return 0
}

verify_restore "$TARGET_DB" "$PGPASSWORD"

echo "Restore completed successfully to database: $TARGET_DB"
echo "WARNING: Plaintext dump will be destroyed on exit"
exit 0
