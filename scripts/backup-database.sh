#!/bin/bash
# Backup PostgreSQL database with age encryption (authenticated AEAD).
#
# Usage:
#   scripts/backup-database.sh <recipient-file> [output.sql.enc]

set -euo pipefail

# Required arguments
if [ $# -lt 1 ]; then
  echo "ERROR: Usage: $0 <recipient-file> [output.sql.enc]" >&2
  exit 1
fi

RECIPIENT_FILE="$1"
OUTPUT_FILE="${2:-backup-$(date +%s).sql.enc}"

# Verify recipient file exists and is readable
if [ ! -f "$RECIPIENT_FILE" ]; then
  echo "ERROR: Recipient file not found: $RECIPIENT_FILE" >&2
  exit 1
fi

if [ ! -r "$RECIPIENT_FILE" ]; then
  echo "ERROR: Recipient file not readable: $RECIPIENT_FILE" >&2
  exit 1
fi

# Check age command exists
if ! command -v age >/dev/null 2>&1; then
  echo "ERROR: age command not found. Install from https://github.com/FiloSottile/age" >&2
  exit 1
fi

# Required environment variables
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set" >&2
  exit 1
fi

# Temp directory and files with restrictive permissions
TMPDIR_ROOT="${TMPDIR:-/tmp}"
TMPDIR=$(mktemp -d "${TMPDIR_ROOT}/.quiksend-backup.XXXXXX") || {
  echo "ERROR: Failed to create temp directory" >&2
  exit 1
}
chmod 0700 "$TMPDIR"

PLAINTEXT_DUMP="${TMPDIR}/dump.sql"
CIPHER_FILE="${TMPDIR}/dump.sql.enc"

# Trap on every exit: remove plaintext and temp files
cleanup() {
  local exit_code=$?
  rm -f "$PLAINTEXT_DUMP"
  if [ $exit_code -ne 0 ] && [ -f "$CIPHER_FILE" ]; then
    rm -f "$CIPHER_FILE"
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
[ -n "$PGPASSWORD" ] && export PGPASSWORD
# Dump database to plaintext file (0600 during write, 0400 after)
touch "$PLAINTEXT_DUMP"
chmod 0600 "$PLAINTEXT_DUMP"

pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
  -F custom -f "$PLAINTEXT_DUMP" > /dev/null 2>&1 || {
  echo "ERROR: pg_dump failed" >&2
  exit 1
}

if [ ! -s "$PLAINTEXT_DUMP" ]; then
  echo "ERROR: pg_dump produced empty file" >&2
  exit 1
fi

chmod 0400 "$PLAINTEXT_DUMP"

# Encrypt with age (authenticated AEAD encryption)
touch "$CIPHER_FILE"
chmod 0600 "$CIPHER_FILE"

age -R "$RECIPIENT_FILE" -o "$CIPHER_FILE" "$PLAINTEXT_DUMP" || {
  echo "ERROR: age encryption failed" >&2
  exit 1
}

# Verify ciphertext was created
if [ ! -s "$CIPHER_FILE" ]; then
  echo "ERROR: Encryption produced empty file" >&2
  exit 1
fi

mv "$CIPHER_FILE" "$OUTPUT_FILE" || {
  echo "ERROR: Failed to move encrypted backup to $OUTPUT_FILE" >&2
  exit 1
}

echo "Backup completed: $OUTPUT_FILE"
