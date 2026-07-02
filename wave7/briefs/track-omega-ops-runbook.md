# TRACK OMEGA-OPS — Phase 11C: Provider Seed Pool Operational Runbook

## Repo
`/Users/beckett/Projects/quik-ideas/quiksend`

## Branch
`docs/wave7-omega-ops-runbook` from `main` (worktree isolated).

## Goal

Write the internal operational runbook for provisioning the Quiksend-managed seed
inbox pool that powers Deliverability Pro. Track PHI is writing the CODE that
consumes this pool; you write the OPERATIONS docs that a Quiksend Systems team
member follows to actually acquire the domains, provision the mailboxes, subscribe
to the SEGs, and bootstrap the pool.

**Explicit non-goal**: do NOT actually purchase any domain or subscribe to any SEG.
That's a human decision + budget approval. You write the runbook so it CAN be done.

**Explicit non-goal**: do NOT touch any `.ts` file. Pure docs.

## Context (read in order)
1. `CLAUDE.md`
2. `wave7/WAVE_CONTEXT.md`
3. `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` § Phase 11C Mechanics — the provider-managed seed pool section
4. `docs/self-host.md` — style reference for operational docs
5. `docs/nango-setup.md` — style reference for step-by-step provisioning docs
6. `docs/troubleshooting.md` — style reference for runbook format

## What ships

### 1. `internal-runbooks/README.md` (NEW dir + README)

Explain what `internal-runbooks/` is:
- Internal ops docs, not shipped to end users
- Contains procedures Quiksend Systems team follows to operate hosted-tier features
- NOT the same as `docs/` which is user-facing
- Files here may reference private credentials (references only; secrets live in
  password manager, not the repo)

### 2. `internal-runbooks/seed-pool-setup.md` (NEW — the main deliverable)

The full runbook covering the pool setup. Structure:

```markdown
# Seed Pool Setup Runbook

## What this pool is
Brief explanation: 12 seed inboxes (3 per SEG × 4 SEGs) that Quiksend operates
to power Deliverability Pro. Users on the paid tier get canary sends injected
into their campaigns; those sends land in these seed inboxes; the canary polling
worker measures arrival rate.

## Pool architecture

Table: 12 seeds, 4 SEGs, cost per seed, total monthly cost.

| SEG | Seeds | Domain | Mail host | Total |
|---|---|---|---|---|
| Proofpoint | 3 | apex-mail.net, nova-corp-mail.com, bright-office.co | M365 Business ($6/seat) | 3 × $6 + $2 SEG = $24/mo |
| ... | ... | ... | ... | ... |

## Prerequisites
- Registrar account (Namecheap, Cloudflare Registrar, etc.)
- Microsoft partner or direct M365 admin account
- Google Workspace admin account (secondary hoster)
- Company info for SEG business signups: legal name, EIN, business address
- Budget approval: ~$200/mo baseline

## Domain acquisition

### Domain selection principles
- Reasonable-sounding business names (not obvious canary farms)
- Vary TLDs: .com, .net, .co, .io mix
- Vary naming patterns: some 2-word, some 3-word, some abbreviated
- Age 3-6 months before first canary send (many SEGs downgrade very-new domains)
- **AVOID**: hyphenated 5+ character names, exact-match spam-alert words, dictionary joins that scream "mail testing"

### 12 domain slots (fill in during purchase)
1. Proofpoint seed 1 — TBD
2. Proofpoint seed 2 — TBD
3. Proofpoint seed 3 — TBD
4. Mimecast seed 1 — TBD
...

### Purchase step-by-step
1. Log in to registrar
2. Search for domain
3. Purchase 1-year with WHOIS privacy on
4. Set DNS to registrar's default nameservers (change later when adding MX)

## Mail host provisioning

### Microsoft 365 Business Basic ($6/user/mo)
Recommended for: 2 seeds per SEG (best for Mimecast, Proofpoint due to M365 trust)

Step-by-step:
1. Sign up at admin.microsoft.com — new tenant per seed group
   - Rationale: separate tenants = separate reputation; a bad seed doesn't drag the others
2. Verify domain via DNS TXT
3. Create the mailbox user (name should look human — first-last format)
4. Enable IMAP access (needed for canary polling): Admin Center → Users → mailbox settings → Email apps → IMAP on
5. Configure MFA-alternative for programmatic access:
   - Preferred: OAuth via Nango for polling
   - Fallback: app password via `outlook.office365.com:993` IMAP with basic auth
6. Note IMAP settings for the seed-pool-config.json:
   - Host: `outlook.office365.com`
   - Port: 993
   - Username: full email
   - Encrypted password: filled in per-seed at bootstrap time

### Google Workspace Business Starter ($7/user/mo)
Recommended for: 1 seed per SEG (secondary provider — variety = signal)

Step-by-step:
1. Sign up at workspace.google.com/business/signup
2. Verify domain
3. Create mailbox user
4. Enable IMAP: Admin Console → Apps → Google Workspace → Gmail → IMAP → On
5. Generate app-specific password (2FA required first)
6. IMAP settings:
   - Host: `imap.gmail.com`
   - Port: 993
   - Username: full email
   - Encrypted password: filled in per-seed

## SEG subscription setup

### Proofpoint Essentials
- **How to sign up**: contact Proofpoint sales (proofpoint.com/us/products/small-business) — enterprise sold through partners
- **Business info required**: EIN, business address, phone verification
- **Cost**: $2-5/user/month, minimum seat count 3
- **Setup timeline**: 3-7 business days for account activation
- **MX configuration**:
  - After account activation, get your assigned mail-flow servers
  - Update seed domain's MX to `mx1-usX.ppe-hosted.com` (where X = your region)
  - Priorities: 10, 20 for redundancy
  - Verify propagation via `dig MX apex-mail.net` — expect Proofpoint's hosts
- **Filtering policy**: default enterprise-safety policy (block obvious spam, allow legitimate). Do NOT tighten beyond default — we want the seed to look like a real user's inbox.
- **Inbound routing**: Proofpoint filters → forwards clean to M365 tenant's `mx.protection.outlook.com`. This is the standard "SEG in front of M365" enterprise pattern.

Screenshot references: [private wiki]

### Mimecast
- **How to sign up**: 30-day free trial at mimecast.com/products/gateway/, then $4-6/user/month
- **Business info required**: EIN, business address
- **Setup timeline**: 1-2 business days for trial account
- **MX configuration**: MX to `us-smtp-inbound-1.mimecast.com` + `us-smtp-inbound-2.mimecast.com` (or your region's)
- **Filtering policy**: Managed Policies → Anti-Spoofing on, Anti-Impersonation on (mimic a real enterprise setup)
- **Inbound routing**: Mimecast → M365 tenant

Screenshot references: [private wiki]

### Barracuda Email Protection
- **How to sign up**: 30-day free trial at barracuda.com/products/email-protection
- **Cost after trial**: $3-8/user/month depending on Advanced/Premium tier
- **Setup timeline**: 1 business day
- **MX configuration**: MX to `mx.essentialscloud.com` (or the specific region host in your account)
- **Filtering policy**: Advanced Threat Protection on, defaults elsewhere
- **Inbound routing**: Barracuda → M365 or Google Workspace tenant

Screenshot references: [private wiki]

### Cisco Secure Email (Cloud Gateway)
- **How to sign up**: contact Cisco sales — trial available (30-day)
- **Cost**: $5-10/user/month enterprise-sold through partners
- **Setup timeline**: 5-10 business days
- **MX configuration**: MX to `mx.iphmx.com` (regional host per your allocation)
- **Filtering policy**: default SecureX policy
- **Inbound routing**: Cisco → downstream tenant

Screenshot references: [private wiki]

## Post-provisioning: seed onboarding to the app

### The config file

`internal-runbooks/seed-pool-config.json` (NOT COMMITTED — lives in password
manager or separate secure vault). Shape:

```json
[
  {
    "email": "sarah.chen@apex-mail.net",
    "gateway": "proofpoint",
    "provider": "microsoft_365",
    "imap_host": "outlook.office365.com",
    "imap_port": 993,
    "imap_username": "sarah.chen@apex-mail.net",
    "imap_password": "REDACTED",
    "pool_tag": "production",
    "notes": "Provisioned 2026-08-15; Proofpoint tier: Advanced"
  },
  ...
]
```

### Bootstrap script

Track PHI ships `scripts/seed-pool-bootstrap.ts`. It reads the config JSON (path from
env var `SEED_POOL_CONFIG_PATH`), encrypts credentials with
`SYSTEM_SEED_ENCRYPTION_KEY`, and inserts rows into `seed_inbox` with
`organization_id = NULL`.

**Run once at initial pool provisioning**:
```bash
SEED_POOL_CONFIG_PATH=/secure/vault/seed-pool-config.json \
SYSTEM_SEED_ENCRYPTION_KEY=... \
pnpm tsx scripts/seed-pool-bootstrap.ts
```

Idempotent: existing seeds match on email and update rather than duplicate.

## Ongoing operations

### Weekly: health check
Cron `seed_pool.health_check` runs every 24h (Track PHI ships this).
Alerts to on-call channel if:
- Any seed's IMAP LOGIN fails
- Any seed's inbox has < 5 non-canary messages in 30 days (looks dormant → SEG downgrade risk)

Manual step if alerted:
1. Log in to seed's webmail
2. If auth broken: reset password, regenerate app password, update config
3. If dormant: subscribe to more newsletters (see legit-usage generator below)

### Weekly: legit-usage generator
Cron `seed_pool.generate_legit_mail` (Track PHI ships this).
Generates internal-business-looking mail among the seeds:
- Calendar invites (auto-accept)
- Weekly digest emails
- Occasional "invoice reminder" and "meeting notes" templates

**Vary content, cap volume at 5 messages/seed/week.** This is at the boundary of
SEG-cheating; treat as tasteful garnish, not spam.

### Monthly: rotate a domain if reputation degrades
If a domain's canary delivery rate to any SEG drops below 60% for 7+ days:
1. Purchase replacement domain (steps above)
2. Provision new mailbox
3. Configure new SEG subscription (or reuse existing SEG account with new subdomain)
4. Bootstrap into DB with new seed row, mark old seed inactive
5. Old domain: park for 6 months in case reputation recovers, then let expire

## Cost tracking

Monthly recurring:
- 12 mail seats × $6-7/mo = $72-84/mo
- 4 SEG subscriptions × ~$10/mo × 3 seats each = $120/mo
- 12 domains × $1/mo amortized = $12/mo
- **Total baseline: ~$200/mo**

Break-even at Deliverability Pro tier ($99/mo per workspace):
- 3 Pro subscribers cover cost
- 20+ subscribers = healthy margin

## Security considerations

- Seed inbox credentials live in a **separate encryption domain** from workspace mailbox credentials
  - Workspace: `MAILBOX_ENCRYPTION_KEY`
  - System seeds: `SYSTEM_SEED_ENCRYPTION_KEY`
  - Keys never coexist in the same env; workspace admins never see system seeds
- Self-hosters get user-provided seeds only (no `SYSTEM_SEED_ENCRYPTION_KEY` in self-host env)
- Audit log all provider-managed seed credential access via `seed_inbox_credential_access` event type (Track PHI ships this)
- Rotate seed passwords every 6 months (calendar reminder)

## Emergency runbook: pool is compromised

If we discover a competitor has fingerprinted a seed and is poisoning the signal:

1. Immediately deactivate all seeds for that SEG via UPDATE
2. Purchase fresh domains + provision new tenants (7-14 days)
3. Communicate to Pro-tier customers: "Deliverability Pro degraded for [SEG] while we rotate; expect noisier grid for 2 weeks"
4. Do not disclose specific seeds publicly

## Appendix: SEG contact information

Sales / support contacts, account IDs, ticket portals per SEG.
(Filled in at first setup; lives in private wiki, referenced from here.)
```

### 3. `internal-runbooks/seed-pool-config.example.json` (NEW example only)

An example config with fake data:

```json
[
  {
    "email": "example.name@example-seed-domain.net",
    "gateway": "proofpoint",
    "provider": "microsoft_365",
    "imap_host": "outlook.office365.com",
    "imap_port": 993,
    "imap_username": "example.name@example-seed-domain.net",
    "imap_password": "REDACTED-EXAMPLE",
    "pool_tag": "production",
    "notes": "Example config; do not use for real pool."
  }
]
```

### 4. `internal-runbooks/seed-pool-legit-usage-patterns.md` (NEW)

Templates for the legit-usage generator. Real business-looking mail templates the
Track PHI cron can rotate through. 5-10 templates covering:
- Meeting notes
- Weekly digest
- Invoice reminder
- Calendar invite
- Newsletter subscription confirmations
- Project status update
- Internal announcements

Vary tone (formal / friendly / brief), sender (self / colleague), subject patterns
(no spammy phrasing).

### 5. `internal-runbooks/README.md` (NEW)

Overview + index of all runbooks in this directory. Currently just:
- `seed-pool-setup.md`
- `seed-pool-legit-usage-patterns.md`
- `seed-pool-config.example.json`

Note: real configs and secrets NEVER commit here.

### 6. `.gitignore` update

Add `internal-runbooks/seed-pool-config.json` (the non-example real one, if it ever
ends up in the tree by accident).

## Documentation lookup (mandatory)
Context7 MCP for:
- **Microsoft 365 admin center** — current IMAP enablement flow (may have changed)
- **Google Workspace** — current app-password flow (may have changed)
- **Proofpoint / Mimecast / Barracuda / Cisco** — current MX configuration + business signup flow

Screenshot references are placeholders; internal wiki will host the actual images.
Document what a Systems team member should capture during first-time setup.

## Files owned (strict)

- `internal-runbooks/README.md` (NEW)
- `internal-runbooks/seed-pool-setup.md` (NEW — the main deliverable)
- `internal-runbooks/seed-pool-legit-usage-patterns.md` (NEW)
- `internal-runbooks/seed-pool-config.example.json` (NEW)
- `.gitignore` (add real config exclusion)

## Do NOT touch

- Any `.ts` file
- Any `docs/*.md` (user-facing; not your scope)
- `scripts/seed-pool-bootstrap.ts` — Track PHI ships this

## Verification

```bash
pnpm install --frozen-lockfile
pnpm check   # docs-only; should be no-op
```

Manual smoke test:
- Read your own runbook end-to-end. Would a Systems team member unfamiliar with
  Quiksend follow it without questions?
- Verify every URL cited (SEG signup pages, admin consoles) still exists.
- Verify cost numbers are current-2026 (they might drift; note the "as of"
  timestamps).

## Result

```json
{
  "status": "ok",
  "track": "OMEGA-OPS",
  "phase_section": "11C-ops",
  "tickets_completed": ["11C.15", "11C.16", "11C.17-docs", "11C.18-runbook", "11C.19-templates"],
  "files_changed": [...],
  "docs_added": [...],
  "notes": "Runbook shipped. Actual pool provisioning is a human calendar task (~1-2 weeks); this doc makes it executable."
}
```
