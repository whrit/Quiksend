# Backup and Restore Runbook

**Security Level:** Restricted (encryption keys, database credentials)

## Overview

Encrypted database backup and restore for Quiksend production. Backups are encrypted with [age](https://github.com/FiloSottile/age) (authenticated AEAD — X25519 + ChaCha20-Poly1305). Plaintext never persists past script exit.

## Key Management

- **Generate keypair:** `age-keygen -o key.txt` (prints public key to stdout)
- **Recipient file:** one `age1...` public key per line, used for backup
- **Identity file:** private key (`key.txt`), permissions must be `0600`, used for restore
- **Storage:** Identity in 1Password or Vault. Recipient file safe to commit. Rotate annually; keep 2 recent keypairs.

## Creating a Backup

```bash
export DATABASE_URL="postgres://user:password@host:5432/quiksend"
scripts/backup-database.sh recipients.txt [output.sql.enc]
```

Output: encrypted custom-format pg_dump. Safe to store anywhere.

## Restoring a Backup

### To temporary database (verification)

```bash
export DATABASE_URL="postgres://user:password@host:5432/quiksend"
scripts/restore-database.sh backup.sql.enc ~/.age/key.txt
# creates quiksend_restore_<timestamp>, verifies migration marker + table counts
```

### To specific database

```bash
scripts/restore-database.sh backup.sql.enc ~/.age/key.txt quiksend_staging
```

### Verification output

```
Migration marker: 0024
Table organization: 150 rows
Table message: 45000 rows
Table enrollment: 12300 rows
```

If counts differ significantly from expected, **stop** before promoting.

## Production Cutover

Requires approved incident ticket, maintenance window, confirmed read-only replica.

1. Verify backup integrity (restore to temp DB, check counts)
2. Stop application traffic
3. Restore to temp DB on primary cluster
4. Sample-query both DBs for logical comparison
5. Promote temp DB as primary
6. Smoke-test application connectivity
7. Monitor error logs 15 min before resuming traffic

### Rollback

```bash
psql -c "DROP DATABASE quiksend_staging;"
# promote previous replica, restart application
```

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Decryption failed" | Wrong identity file or corrupted backup | Verify identity in 1Password; try alternate backup date |
| pg_restore "permission denied" | User lacks DDL privs | Use `quiksend_migrator` role, not `quiksend_app` |
| Temp cleanup fails | Disk full | `df -h /tmp`; `rm -rf /tmp/.quiksend-*` |

## Testing

```bash
pnpm test scripts/backup-restore.test.ts
```

## See Also

- [RELEASING.md](../RELEASING.md) — Release and rollback procedures
- `.github/workflows/ci.yml` — CI pipeline
- `scripts/init-postgres.sh` — Database initialization
