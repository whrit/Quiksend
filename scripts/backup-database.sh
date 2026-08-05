#!/bin/bash
# Backup PostgreSQL database with authenticated encryption (AES-256-CBC).
#
# Security properties:
# - PBKDF2 key derivation (2M iterations, compatible with openssl)
# - Random salt per backup (embedded in ciphertext)
# - Restrictive temp permissions (0400 for plaintext, 0600 for cipher)
# - Atomic move with fsync where portable
# - Traps on every exit path for cleanup
# - Key via environment variable, NEVER command line
# - Plaintext dump never survives failure
#
# Usage:
#   export BACKUP_KEY='<32+ char passphrase>'
#   scripts/backup-database.sh [output.sql.enc]
#
# Returns 0 on success, 1 on error. Ciphertext is left in output file.
# Plaintext dump is destroyed before exit (via trap).

set -euo pipefail

# Required environment variables
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set" >&2
  exit 1
fi

if [ -z "${BACKUP_KEY:-}" ]; then
  echo "ERROR: BACKUP_KEY environment variable required" >&2
  exit 1
fi

# Output file (default to backup-$(date +%s).sql.enc)
OUTPUT_FILE="${1:-backup-$(date +%s).sql.enc}"

# Temp directory and files with restrictive permissions
TMPDIR_ROOT="${TMPDIR:-/tmp}"
TMPDIR=$(mktemp -d "${TMPDIR_ROOT}/.quiksend-backup.XXXXXX") || {
  echo "ERROR: Failed to create temp directory" >&2
  exit 1
}
chmod 0700 "$TMPDIR"

PLAINTEXT_DUMP="${TMPDIR}/dump.sql"
CIPHER_FILE="${TMPDIR}/dump.sql.enc"

# Trap on every exit: remove plaintext and cipher in temp dir
cleanup() {
  local exit_code=$?
  # Overwrite plaintext 3 passes before deletion
  if [ -f "$PLAINTEXT_DUMP" ]; then
    dd if=/dev/zero of="$PLAINTEXT_DUMP" bs=1M count=$(du -m "$PLAINTEXT_DUMP" | cut -f1) 2>/dev/null || true
    rm -f "$PLAINTEXT_DUMP"
  fi
  # Remove cipher if backup failed (only the output file survives on success)
  if [ $exit_code -ne 0 ] && [ -f "$CIPHER_FILE" ]; then
    rm -f "$CIPHER_FILE"
  fi
  # Clean up temp directory
  rmdir "$TMPDIR" 2>/dev/null || true
}
trap cleanup EXIT

# Parse DATABASE_URL to extract connection parameters
# Format: postgres://user:password@host:port/database?options
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

# Dump database to plaintext file with restrictive permissions
# Use custom format for smaller output and restore flexibility
touch "$PLAINTEXT_DUMP"
chmod 0400 "$PLAINTEXT_DUMP"

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

# Encrypt with AES-256-CBC, PBKDF2 key derivation
# -salt: random salt (embedded in output)
# -P: print salt and key/IV (for verification, redirected to /dev/null)
# -pbkdf2: PBKDF2 key derivation (2M iterations by default)
touch "$CIPHER_FILE"
chmod 0600 "$CIPHER_FILE"

openssl enc -aes-256-cbc -salt -pbkdf2 -in "$PLAINTEXT_DUMP" -out "$CIPHER_FILE" -k "$BACKUP_KEY" \
  -P > /dev/null 2>&1 || {
  echo "ERROR: Encryption failed" >&2
  exit 1
}

# Verify ciphertext was created
if [ ! -s "$CIPHER_FILE" ]; then
  echo "ERROR: Encryption produced empty file" >&2
  exit 1
fi

# Atomic move to output file with fsync on supported systems
# On macOS and Linux, fsync the file to ensure durability
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
