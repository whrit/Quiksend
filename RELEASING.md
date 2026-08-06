# Release Procedures

**Release Cycle:** Continuous (main → automated releases)  
**Approval:** GitHub CODEOWNERS + peer review

## Release Process

### 1. Automatic Release PR (release-please)

Conventional commits (`feat:`, `fix:`, etc.) on `main` trigger a release PR with version bump, CHANGELOG, and git tag.

### 2. Merge Release PR

```bash
git fetch origin
git log origin/main..origin/release-please-*   # review changes
gh pr merge --auto --squash                     # tag created on merge
```

### 3. Container Images (automatic on tag)

Built and pushed to GHCR: `vX.Y.Z`, `latest`, `sha-XXXXXX`.

### 4. Image Signing

Cosign keyless via GitHub OIDC. Verify with:

```bash
cosign verify ghcr.io/$OWNER/quiksend-web:vX.Y.Z \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity https://github.com/$OWNER/quiksend/.github/workflows/release-please.yml@refs/heads/main
```

## Pinned Actions

All third-party GitHub Actions pinned by immutable SHA, never mutable tags or branches.

## Rollback Procedures

### Level 1: Revert (Code)

```bash
git revert <commit-sha>
git push origin HEAD          # triggers new patch release
```

### Level 2: Roll Back Image

```bash
PREV=$(git describe --tags --abbrev=0 HEAD~1)
kubectl set image deployment/quiksend-web web=ghcr.io/$OWNER/quiksend-web:$PREV
kubectl rollout status deployment/quiksend-web
curl -s https://api.quiksend.com/health | jq .
```

### Level 3: Restore from Database Backup

See [internal-runbooks/backup-restore.md](./internal-runbooks/backup-restore.md).

## Manual Release (if automated fails)

```bash
jq .version package.json
git checkout -b chore/release-vX.Y.Z
# bump package.json version, update CHANGELOG.md
git commit -am "chore: release vX.Y.Z"
git push origin chore/release-vX.Y.Z
gh pr create --title "chore: release vX.Y.Z" --draft
gh pr merge --auto --squash
```

## Emergency Release

```bash
git checkout main && git pull
git checkout -b fix/security-vuln
# apply ONLY the security patch
git commit -am "fix: close vulnerability CVE-2026-XXXXX"
git push origin fix/security-vuln
# release-please auto-bumps patch on merge
```

## Deployment

```bash
TAG=$(git describe --tags --abbrev=0 HEAD)
kubectl set image deployment/quiksend-web web=ghcr.io/$OWNER/quiksend-web:$TAG
kubectl rollout status deployment/quiksend-web
curl -I https://api.quiksend.com/health
# monitor error rates 15 min — alert if >1% or P95 >2s
```

## Release Checklist

- [ ] CHANGELOG reviewed
- [ ] CI passes
- [ ] Images built, scanned, signed, SBOM attached
- [ ] Rollback command documented
- [ ] On-call DBA notified

## See Also

- [backup-restore.md](./internal-runbooks/backup-restore.md) — Database restore runbook
- `.github/workflows/release-please.yml` — Release automation
- `.github/release-please-config.json` — Release config

## CI Gate and Image Build Flow

The `.github/workflows/ci.yml` `build-images` job acts as a CI gate for releases:

1. **On every push to main:** CI builds both `quiksend-web` and `quiksend-worker` images and runs health smoke tests:
   - **quiksend-web**: Verifies HTTP GET `/api/health` returns 200 (via Docker HEALTHCHECK)
   - **quiksend-worker**: Verifies `/tmp/worker-ready` heartbeat file exists and is < 90s old

2. **If CI passes:** Images are considered production-ready. Release workflow reuses the same Dockerfiles to build release images (identical SHA, no rebuild needed).

3. **If CI fails:** Release workflow is blocked (no duplicate builds).

This ensures release images are proven healthy before shipping. See `.github/workflows/ci.yml` `build-images` job for smoke test implementation.
