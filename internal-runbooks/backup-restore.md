# Backup and Restore Runbook

**Last Updated:** 2026-08-04  
**Security Level:** Restricted (encryption keys, database credentials)

## Overview

This runbook covers encrypted database backup and restore operations for Quiksend production databases. All backups are encrypted with AES-256-CBC using PBKDF2 key derivation, ensuring that plaintext never persists to disk even in failure scenarios.

## Security Properties

- **Encryption**: AES-256-CBC with PBKDF2 (2M iterations)
- **Key Management**: Environment variable only (never argv, files, or logs)
- **Temp File Permissions**: 0400 (read-only) for plaintext dumps
- **Cleanup**: Aggressive overwrite on every exit path via trap handlers
- **Atomicity**: Encrypted output is moved atomically with fsync for durability
- **Plaintext Exposure**: Minimal—plaintext exists only in temp directories with restrictive permissions

## Creating a Backup

### Prerequisites

- PostgreSQL client tools (`pg_dump`, `pg_restore`)
- OpenSSL 1.1.1+ (for `enc -pbkdf2`)
- Access to production database via `DATABASE_URL`
- A secure backup key (32+ characters, random)

### Procedure

```bash
# 1. Set environment variables (never pass key via command line)
export DATABASE_URL="postgres://user:password@host:5432/quiksend"
export BACKUP_KEY="<32+ random characters>"

# 2. Create backup
scripts/backup-database.sh [output.sql.enc]

# Output: "Backup completed: output.sql.enc"
```

### Output

- **File**: `output.sql.enc` (encrypted, custom PostgreSQL format)
- **Size**: ~30-50% smaller than plain SQL due to custom format + entropy from PBKDF2 salt
- **Storage**: Safe to store in version control, S3, or any untrusted location

### Backup Key Management

- **Generation**: Use `openssl rand -base64 32` or a secure password manager
- **Storage**: Store in:
  - GitHub Secrets (for CI/CD)
  - 1Password or Vault for manual operations
  - Never in code, logs, or command history
- **Rotation**: Backup keys should be rotated annually; keep at least 2 recent keys for restore compatibility

## Restoring a Backup

### Prerequisites

- Backup file (encrypted)
- Correct backup key
- Access to production database (or staging target)
- PostgreSQL client tools

### Procedure: Restore to Temporary Database (Verification)

```bash
# 1. Set environment variables
export DATABASE_URL="postgres://user:password@host:5432/quiksend"
export BACKUP_KEY="<same key used for backup>"

# 2. Restore to temporary database (auto-named)
scripts/restore-database.sh backup.sql.enc

# Output: "Restore completed successfully to database: quiksend_restore_1722760000"
```

The script will:
1. Decrypt the backup to a secure temp directory
2. Create a new database
3. Restore the dump using `pg_restore`
4. Verify migration markers and table counts
5. Clean up plaintext dump (overwritten + deleted)

### Procedure: Restore to Specific Database

```bash
# Restore to a named database (existing tables may conflict)
scripts/restore-database.sh backup.sql.enc quiksend_staging

# Output: "Restore completed successfully to database: quiksend_staging"
```

### Verification

The restore script automatically logs table counts:

```
Migration marker: 0024
Table organization: 150 rows
Table message: 45000 rows
Table enrollment: 12300 rows
```

If these values differ significantly from expected production counts, **stop** and investigate before proceeding to promote the restored database.

## Production Restore (Cutover)

**This procedure requires multiple approval steps and should only be performed during maintenance windows.**

### Prerequisites

- Approved incident ticket with rollback plan
- Backup key confirmed with ops
- Read-only replica confirmed working
- Communication to users initiated

### Procedure

1. **Verify backup integrity** (see Verification above)
2. **Connect to source cluster** (primary, not read-only)
3. **Stop application traffic** (maintenance window)
4. **Run restore to temporary DB** (confirm counts match expected)
5. **Perform logical comparison** (sample queries on both DBs)
6. **Promote temporary DB as primary** (via platform automation)
7. **Verify application connectivity** (smoke tests)
8. **Monitor error logs** (15 minutes before resuming traffic)
9. **Resume user traffic** (gradual ramp-up)
10. **Archive backup** (for compliance audit trail)

### Rollback

If the restored database fails validation:

```bash
# 1. Stop application
# 2. Drop restored database
psql -c "DROP DATABASE quiksend_staging;"

# 3. Promote previous replica
# 4. Restart application

# Timeline: ~5 minutes for full recovery
```

## Common Issues

### Decryption Fails: "wrong key or corrupted backup?"

**Cause**: Backup key does not match, or file is corrupted  
**Fix**:
1. Verify backup key with ops (check 1Password or secrets manager)
2. Verify backup file integrity: `openssl enc -P -aes-256-cbc -d -pbkdf2 -in backup.sql.enc -k "test" 2>&1 | head -3`
3. If file is corrupted, restore from a different backup date

### pg_restore Fails with "permission denied"

**Cause**: User lacks DDL privileges  
**Fix**:
1. Ensure `DATABASE_URL` user is `quiksend_migrator` (not `quiksend_app`)
2. Verify user has `CREATE` privilege: `psql -c "\\du" | grep quiksend_migrator"`
3. If missing, grant: `psql -c "GRANT CREATE ON DATABASE quiksend TO quiksend_migrator;"`

### Temp Directory Cleanup Fails

**Cause**: Disk full, or permissions issue  
**Fix**:
1. Check disk space: `df -h /tmp`
2. Manually clean: `rm -rf /tmp/.quiksend-*`
3. Verify plaintext dump was overwritten before deletion

## Testing

Run the test suite to verify backup/restore operations:

```bash
# Run tests (requires test database)
pnpm test scripts/backup-restore.test.ts

# Tests verify:
# - Ciphertext doesn't contain plaintext
# - Wrong key fails decryption
# - Round-trip encryption/decryption
# - Temp file cleanup
# - Permission enforcement (0400)
```

## Monitoring and Alerting

### Backup Monitoring

- **Frequency**: Daily at 2 AM UTC (via GitHub Actions)
- **Retention**: 30 days (older backups archived to cold storage)
- **Success Criteria**: Ciphertext file exists and is > 10 MB
- **Alert**: Failure to create backup within 24 hours

### Restore Testing

- **Frequency**: Weekly (automated restore to staging database)
- **Success Criteria**:
  - Decryption succeeds with correct key
  - Migration marker is current
  - Table counts match within 1%
  - Smoke tests pass on restored database
- **Alert**: Restore test failure escalates to on-call DBA

## Compliance

- **Encryption**: AES-256-CBC meets NIST SP 800-175B requirements
- **Key Derivation**: PBKDF2 (2M iterations) meets OWASP guidance
- **Audit Trail**: All backup operations logged in CI/CD with encrypted artifact tracking
- **Data Retention**: Backups retained for 30 days; older backups archived to encrypted cold storage

## See Also

- [RELEASING.md](./RELEASING.md) — Production release procedures
- `.github/workflows/ci.yml` — Automated CI/CD pipeline
- `scripts/init-postgres.sh` — Database initialization and role setup
