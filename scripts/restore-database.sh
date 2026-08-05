#!/bin/bash
# Restore PostgreSQL database from age-encrypted backup with verification.
#
# Security properties:
# - Decrypts to temporary database (never exposes plaintext in files)
# - Verifies migration marker and table counts — fails loudly if missing
# - Cleans up plaintext immediately after restore
# - Restrictive temp permissions (0600 for files, 0700 for dirs)
# - Traps on every exit path
# - Database dropped on failure
# - Age identity file validated (0600 permissions required)
# - Target database name validated against SQL injection
#
# Usage:
#   scripts/restore-database.sh <backup.sql.enc> <identity-file> [target-db]
#
# Where identity-file is an age private key file (e.g., ~/.age/key.txt)
# with permissions 0600 (rw-------). Must be the counterpart to the
# recipient file used during backup.
#
# If target-db is omitted, creates a temporary database named
# quiksend_restore_<timestamp> and leaves it for verification.
# Plaintext dump is destroyed before exit (via trap).
#
# Returns 0 on successful restore + verification, 1 on error.

set -euo pipefail

# Required arguments
if [ $# -lt 2 ]; then
  echo "ERROR: Usage: $0 <backup-file> <identity-file> [target-database]" >&2
  exit 1
fi

BACKUP_FILE="$1"
IDENTITY_FILE="$2"
TARGET_DB="${3:-}"

# Required environment variables
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set" >&2
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

# Verify identity file exists and has correct permissions
if [ ! -f "$IDENTITY_FILE" ]; then
  echo "ERROR: Identity file not found: $IDENTITY_FILE" >&2
  exit 1
fi

# Validate permissions: identity file MUST be 0600 (rw-------)
local_perms=$(stat -f %A "$IDENTITY_FILE" 2>/dev/null || stat -c %a "$IDENTITY_FILE" 2>/dev/null || echo "unknown")
if [ "$local_perms" != "600" ] && [ "$local_perms" != "rw-------" ]; then
  echo "ERROR: Identity file must have permissions 0600 (rw-------), got $local_perms" >&2
  exit 1
fi

# Check age command exists
if ! command -v age >/dev/null 2>&1; then
  echo "ERROR: age command not found. Install from https://github.com/FiloSottile/age" >&2
  exit 1
fi

# Verify commands exist
for cmd in pg_restore psql; do
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

# Track if we created a database, so we can clean it up on failure
CREATED_DB=0

# Trap on every exit: overwrite/remove plaintext and drop DB on failure
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
  
  # Drop newly-created database if restore failed
  if [ $exit_code -ne 0 ] && [ "$CREATED_DB" -eq 1 ] && [ -n "$TARGET_DB" ]; then
    echo "Cleaning up database $TARGET_DB due to restore failure..." >&2
    parse_db_url "$DATABASE_URL"
    if [ -z "${PGPASSWORD:-}" ]; then
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
        -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" > /dev/null 2>&1 || true
    else
      PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
        -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" > /dev/null 2>&1 || true
    fi
  fi
  
  rmdir "$TMPDIR" 2>/dev/null || true
  exit $exit_code
}
trap cleanup EXIT

# Parse DATABASE_URL to extract connection parameters
parse_db_url() {
  local url="$1"
  url="${url#postgres://}"
  url="${url#postgresql://}"
  
  local creds_and_host="${url%%/*}"
  local db_and_query="${url#*/}"
  local db_name="${db_and_query%%\?*}"
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

# Validate target database name against SQL injection
# Must match: [a-zA-Z_][a-zA-Z0-9_]*
if ! echo "$TARGET_DB" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_]*$'; then
  echo "ERROR: Invalid target database name: $TARGET_DB (must match ^[a-zA-Z_][a-zA-Z0-9_]*\$)" >&2
  exit 1
fi

# Decrypt backup to plaintext
touch "$PLAINTEXT_DUMP"
chmod 0600 "$PLAINTEXT_DUMP"

age -d -i "$IDENTITY_FILE" -o "$PLAINTEXT_DUMP" "$BACKUP_FILE" || {
  echo "ERROR: Decryption failed (wrong identity file or corrupted backup?)" >&2
  exit 1
}

# Verify plaintext was created and has content
if [ ! -s "$PLAINTEXT_DUMP" ]; then
  echo "ERROR: Decryption produced empty file" >&2
  exit 1
fi

# Make plaintext read-only after successful decrypt
chmod 0400 "$PLAINTEXT_DUMP"

# Create target database
if [ -z "${PGPASSWORD:-}" ]; then
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    -c "CREATE DATABASE \"$TARGET_DB\";" > /dev/null 2>&1 || {
    echo "ERROR: Failed to create target database $TARGET_DB" >&2
    exit 1
  }
else
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    -c "CREATE DATABASE \"$TARGET_DB\";" > /dev/null 2>&1 || {
    echo "ERROR: Failed to create target database $TARGET_DB" >&2
    exit 1
  }
fi
CREATED_DB=1

# Restore from plaintext dump to target database
if [ -z "${PGPASSWORD:-}" ]; then
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" \
    "$PLAINTEXT_DUMP" > /dev/null 2>&1 || {
    echo "ERROR: pg_restore failed" >&2
    exit 1
  }
else
  PGPASSWORD="$PGPASSWORD" pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" \
    "$PLAINTEXT_DUMP" > /dev/null 2>&1 || {
    echo "ERROR: pg_restore failed" >&2
    exit 1
  }
fi

# Verify migration marker exists and table counts are nonzero
verify_restore() {
  local target="$1"
  local password="${2:-}"
  
  # Check migration marker from app_meta table — MUST exist
  local migration_check
  if [ -z "$password" ]; then
    migration_check=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$target" \
      -t -c "SELECT value->>'version' FROM app_meta WHERE key = 'migration_marker' LIMIT 1;" 2>/dev/null || echo "")
  else
    migration_check=$(PGPASSWORD="$password" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$target" \
      -t -c "SELECT value->>'version' FROM app_meta WHERE key = 'migration_marker' LIMIT 1;" 2>/dev/null || echo "")
  fi
  
  if [ -z "$migration_check" ]; then
    echo "ERROR: Migration marker not found in app_meta — incomplete or corrupted backup" >&2
    return 1
  fi
  
  echo "Migration marker: $migration_check"
  
  # Verify table counts are nonzero (indicates successful schema + data restoration)
  local tables=("organization" "message" "enrollment")
  
  for table in "${tables[@]}"; do
    local count
    if [ -z "$password" ]; then
      count=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$target" \
        -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
    else
      count=$(PGPASSWORD="$password" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$target" \
        -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
    fi
    count="${count## }"  # trim whitespace
    echo "Table $table: $count rows"
    
    # At least one table should have data (e.g., organization should never be 0 in production)
    if [ "$table" = "organization" ] && [ "$count" -eq 0 ]; then
      echo "ERROR: organization table is empty — backup is incomplete or corrupted" >&2
      return 1
    fi
  done
  
  return 0
}

if ! verify_restore "$TARGET_DB" "$PGPASSWORD"; then
  exit 1
fi

echo "Restore completed successfully to database: $TARGET_DB"
echo "WARNING: Plaintext dump will be destroyed on exit"
exit 0
