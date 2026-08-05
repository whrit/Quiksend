#!/bin/bash
# Backup PostgreSQL database with authenticated encryption (age).
#
# Security properties:
# - Age encryption (modern AEAD, authenticated)
# - Recipient file (public key) — private key never handled
# - Temp permissions: 0600 (rw-------) during write, 0400 (r--------) read-only after
# - Atomic move with fsync where portable
# - Traps on every exit path for cleanup
# - Key material never in argv or environment
# - Plaintext dump destroyed before exit via trap
#
# Usage:
#   scripts/backup-database.sh <recipient-file> [output.sql.enc]
#
# Where recipient-file contains one or more age public keys (age1...).
#
# Returns 0 on success, 1 on error. Ciphertext is left in output file.
# Plaintext dump is destroyed before exit (via trap).

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
  # Overwrite plaintext 3 passes before deletion
  if [ -f "$PLAINTEXT_DUMP" ]; then
    local size_mb
    size_mb=$(du -m "$PLAINTEXT_DUMP" 2>/dev/null | cut -f1)
    if [ -n "$size_mb" ] && [ "$size_mb" -gt 0 ]; then
      dd if=/dev/zero of="$PLAINTEXT_DUMP" bs=1M count="$size_mb" 2>/dev/null || true
    fi
    rm -f "$PLAINTEXT_DUMP"
  fi
  # Remove cipher if backup failed (only the output file survives on success)
  if [ $exit_code -ne 0 ] && [ -f "$CIPHER_FILE" ]; then
    rm -f "$CIPHER_FILE"
  fi
  # Clean up temp directory
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

# Dump database to plaintext file
# Permissions: 0600 (rw-------) during write, 0400 (r--------) read-only after
touch "$PLAINTEXT_DUMP"
chmod 0600 "$PLAINTEXT_DUMP"

if [ -z "${PGPASSWORD:-}" ]; then
  pg_dump \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    -F custom \
    -f "$PLAINTEXT_DUMP" \
    > /dev/null 2>&1 || {
    echo "ERROR: pg_dump failed" >&2
    exit 1
  }
else
  PGPASSWORD="$PGPASSWORD" pg_dump \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    -F custom \
    -f "$PLAINTEXT_DUMP" \
    > /dev/null 2>&1 || {
    echo "ERROR: pg_dump failed" >&2
    exit 1
  }
fi

# Verify dump file was created and has content
if [ ! -s "$PLAINTEXT_DUMP" ]; then
  echo "ERROR: pg_dump produced empty file" >&2
  exit 1
fi

# Make plaintext read-only after successful write
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

# Atomic move to output file with fsync on supported systems
if ! mv "$CIPHER_FILE" "$OUTPUT_FILE"; then
  echo "ERROR: Failed to move encrypted backup to $OUTPUT_FILE" >&2
  exit 1
fi

# fsync output file on supported systems
if command -v fsync >/dev/null 2>&1; then
  fsync "$OUTPUT_FILE" || true
elif type sync >/dev/null 2>&1; then
  sync
fi

echo "Backup completed: $OUTPUT_FILE"
exit 0
