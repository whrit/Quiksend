# Release Procedures

**Last Updated:** 2026-08-04  
**Release Cycle:** Continuous (main branch → automated releases)  
**Approval Process:** GitHub CODEOWNERS + peer review

## Overview

Quiksend uses semantic versioning and release-please for automated changelog and release management. Every merge to `main` with relevant commits triggers a release PR, which creates a GitHub Release and builds container images.

## Release Process

### 1. Automatic Release PR (via release-please)

- **Trigger**: Commit messages matching conventional-changelog (feat:, fix:, docs:, etc.)
- **Workflow**: `.github/workflows/release-please.yml`
- **Output**:
  - Release PR with bumped version (major/minor/patch)
  - Updated CHANGELOG.md
  - Git tag (e.g., `v2.10.0`)

### 2. Merge Release PR

```bash
# 1. Review CHANGELOG and version bump
git fetch origin
git log origin/main..origin/release-please-*

# 2. Approve and merge (via GitHub UI or CLI)
gh pr merge --auto --squash

# Release tag is automatically created on merge
```

### 3. Container Image Build and Push

- **Trigger**: When release tag is created on `main`
- **Images Built**:
  - `ghcr.io/$OWNER/quiksend-web:v2.10.0`
  - `ghcr.io/$OWNER/quiksend-web:latest`
  - `ghcr.io/$OWNER/quiksend-web:$SHORT_SHA`
  - `ghcr.io/$OWNER/quiksend-worker:v2.10.0` (same tag variants)

### 4. Image Signing (SLSA Level 3)

Images are signed with cosign using GitHub OIDC token (keyless signing):

```bash
# Each image is signed with its digest
# Signature stored in GitHub Container Registry

# To verify:
cosign verify ghcr.io/$OWNER/quiksend-web:v2.10.0 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity https://github.com/$OWNER/quiksend/.github/workflows/release-please.yml@refs/heads/main
```

## Workflow: Pinned Actions (SHA Integrity)

All third-party GitHub Actions are pinned by immutable SHA for supply-chain security:

```yaml
# ✓ Correct: Pinned by commit SHA
- uses: actions/checkout@a5ac7e51b41094c7418c8a1a6dad1e1c1351ff8c

# ✗ Incorrect: Version tag (mutable)
- uses: actions/checkout@v4

# ✗ Incorrect: Branch reference (mutable)
- uses: actions/checkout@main
```

### Finding Action SHAs

```bash
# Method 1: GitHub Releases page
# https://github.com/actions/checkout/releases/tag/v4.1.1

# Method 2: Using `gh` CLI
gh release view v4.1.1 --repo actions/checkout --json body

# Method 3: Using git
git ls-remote --heads https://github.com/actions/checkout v4.1.1
```

### Updating Action SHAs

```bash
# 1. Check current action version in .github/workflows/*.yml
grep -n "uses: actions/" .github/workflows/ci.yml

# 2. Get new SHA
gh release view <version> --repo <org/repo> --json targetCommitish

# 3. Update .github/workflows/*.yml
sed -i 's/actions\/checkout@.*/actions\/checkout@<new_sha>/g' .github/workflows/ci.yml

# 4. Test and commit
pnpm run check
git commit -m "chore(ci): pin action SHAs"
```

## Image Scanning and SBOMs

### Container Scanning

Every image build includes:
- **Dependency scanning**: npm audit via lockfile
- **Vulnerability scanning**: trivy or similar
- **License compliance**: SPDX license detection

### SBOM (Software Bill of Materials)

A SBOM is generated and attached to each release:

```bash
# Example: quiksend-web.sbom.json
# Format: CycloneDX or SPDX

# Access via:
gh release download v2.10.0 --pattern "*.sbom.json"

# Review top-level dependencies
jq '.metadata.component.purl' quiksend-web.sbom.json
```

## Rollback Procedures

### Level 1: Revert a Release (Code)

```bash
# 1. Identify bad commit
git log --oneline | head -5

# 2. Revert the commit
git revert <commit-sha>

# 3. Push to main (triggers new release)
git push origin HEAD

# 4. Monitor release pipeline
# New release will have patch bump (e.g., v2.10.1 if v2.10.0 was bad)
```

### Level 2: Roll Back Image Deployment

If the deployed image has critical issues:

```bash
# 1. Identify previous working tag
git describe --tags --abbrev=0 HEAD~1  # e.g., v2.9.9

# 2. Record the rollback command
export ROLLBACK_IMAGE="ghcr.io/$OWNER/quiksend-web:v2.9.9"

# 3. Stop current deployment (platform-specific)
kubectl set image deployment/quiksend-web \
  web=$ROLLBACK_IMAGE

# 4. Verify health
curl -s https://api.quiksend.com/health | jq .

# 5. Document incident
# File: docs/incidents/2026-08-04-rollback.md
```

### Level 3: Restore from Database Backup

If image rollback doesn't resolve the issue (database corruption, data loss):

```bash
# 1. Follow internal-runbooks/backup-restore.md
export BACKUP_KEY="<from 1Password>"
scripts/restore-database.sh backup-2026-08-03.sql.enc quiksend_restore

# 2. Verify counts match expected
# (runbook includes automatic verification)

# 3. Promote restored DB
# (platform-specific automation)

# 4. Restart application
# (health checks will confirm success)

# Timeline: ~15 minutes for full restore
```

## Manual Release Process (If Automated Fails)

### Prerequisites

- Push access to `main`
- GitHub CLI (`gh`) installed and authenticated
- Release notes prepared

### Steps

```bash
# 1. Verify current version
jq .version package.json

# 2. Create release PR manually
# (Normally automated, but useful for one-off releases)
git checkout -b chore/release-v2.10.0

# 3. Update version and CHANGELOG
# Edit package.json: "version": "2.10.0"
# Edit CHANGELOG.md: Add "## 2.10.0" section with notes

# 4. Commit
git commit -am "chore: release v2.10.0"
git push origin chore/release-v2.10.0

# 5. Create PR and wait for checks
gh pr create --title "chore: release v2.10.0" --draft

# 6. Merge PR (auto-create tag)
gh pr merge --auto --squash
```

## Deployment After Release

### Prerequisites

- Image signed and scanned
- SBOM generated
- Rollback plan documented
- On-call DBA notified

### Steps

```bash
# 1. Get latest image tag
LATEST_TAG=$(git describe --tags --abbrev=0 HEAD)

# 2. Deploy (platform-specific)
# Example: Kubernetes
kubectl set image deployment/quiksend-web \
  web=ghcr.io/$OWNER/quiksend-web:${LATEST_TAG}

# 3. Monitor rollout
kubectl rollout status deployment/quiksend-web

# 4. Smoke test
curl -I https://api.quiksend.com/health

# 5. Monitor error rates (15 minutes)
# Alert if error rate > 1% or P95 latency > 2s
```

## Release Checklist

- [ ] CHANGELOG.md reviewed and up-to-date
- [ ] Version bump approved (major/minor/patch)
- [ ] All CI checks pass
- [ ] Container images built and scanned
- [ ] SBOM generated and attached
- [ ] Images signed with cosign
- [ ] Deployment plan reviewed
- [ ] Rollback command documented (in git tag annotation)
- [ ] On-call DBA notified
- [ ] Monitoring dashboards open during deployment
- [ ] Post-release: Error rate < 1%, latency < 2s P95

## CI/CD Permissions (Least Privilege)

```yaml
# release-please job
permissions:
  contents: write        # Create releases and tags
  pull-requests: write   # Create release PRs

# release-images job (runs after release-please)
permissions:
  contents: read         # Read source code for build
  packages: write        # Push to ghcr.io
  id-token: write        # GitHub OIDC (cosign)
```

## Emergency Release (Critical Fix)

If a critical vulnerability requires immediate release:

```bash
# 1. Merge hotfix to main with "fix:" prefix
git checkout main
git pull origin main
git checkout -b fix/security-vuln

# 2. Apply minimal fix
# (ONLY the security patch, no other changes)
git commit -am "fix: close security vulnerability CVE-2026-XXXXX"
git push origin fix/security-vuln

# 3. Create PR and merge
# (release-please will automatically bump patch version)

# 4. Tag is created automatically
# Monitor: https://github.com/$OWNER/quiksend/releases

# Timeline: < 5 minutes from commit to signed image
```

## See Also

- [backup-restore.md](./internal-runbooks/backup-restore.md) — Database restore runbook
- `.github/workflows/release-please.yml` — Release automation
- `.github/release-please-config.json` — Release config and changelog sections
