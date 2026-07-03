# Seed Pool Setup Runbook

**Audience:** Quiksend Systems team  
**Last verified:** 2026-07-02 (pricing and provider flows)  
**Related spec:** `docs/implementations/phases/Quiksend-Implementation-Plan-Phase-11.md` § Provider-managed seed pool

---

## What this pool is

Quiksend operates a **provider-managed seed inbox pool** that powers **Deliverability Pro**
(the paid tier of Phase 11C canary deliverability).

- **12 seed inboxes** minimum: 3 per SEG × 4 SEGs (Proofpoint, Mimecast, Barracuda, Cisco
  Secure Email).
- Paid-tier workspaces get **canary sends** injected into their campaigns. Those canaries
  are addressed to these seeds.
- The **canary polling worker** (`canary-check`) connects via IMAP, measures arrival rate
  and latency, and feeds the deliverability grid + auto-pause logic.
- Seeds live in `seed_inbox` with `organization_id = NULL` — workspace admins never see
  these credentials.

**Explicit non-goal of this runbook:** purchasing domains or subscribing to SEGs. That
requires human budget approval. This document makes the procedure **executable** when
approved.

---

## Pool architecture

| SEG                | Seeds | Example domains (replace at purchase)                     | Mail host mix      | SEG + seats (approx/mo)          |
| ------------------ | ----- | --------------------------------------------------------- | ------------------ | -------------------------------- |
| Proofpoint         | 3     | `apex-mail.net`, `nova-corp-mail.com`, `bright-office.co` | 2× M365, 1× Google | 3 × $7 mail + ~$10 SEG ≈ **$31** |
| Mimecast           | 3     | TBD                                                       | 2× M365, 1× Google | 3 × $7 mail + ~$12 SEG ≈ **$33** |
| Barracuda          | 3     | TBD                                                       | 2× M365, 1× Google | 3 × $7 mail + ~$10 SEG ≈ **$31** |
| Cisco Secure Email | 3     | TBD                                                       | 2× M365, 1× Google | 3 × $7 mail + ~$15 SEG ≈ **$36** |

**Mail flow pattern (all SEGs):** Internet → SEG (MX) → filters → downstream tenant
(M365 `*.mail.protection.outlook.com` or Google `smtp.google.com`).

### Cost summary (as of 2026-07-02)

| Line item                  | Calculation                                         | Monthly       |
| -------------------------- | --------------------------------------------------- | ------------- |
| Mail seats                 | 12 × $7 (M365 Business Basic or GWS Starter annual) | $72–84        |
| SEG subscriptions          | 4 SEGs × ~3 seats × ~$3–5/seat                      | ~$36–60       |
| Domains (amortized)        | 12 × ~$12/yr                                        | ~$12          |
| **Baseline total**         |                                                     | **~$120–156** |
| **Comfortable ops budget** | includes trials, one spare domain, price drift      | **~$200/mo**  |

> **Pricing notes (2026):** Microsoft 365 Business Basic increased to **$7/user/mo** (annual)
> effective 2026-07-01 ([Microsoft licensing update](https://www.microsoft.com/en-us/licensing/news/2026-m365-packaging-pricing-updates)).
> Google Workspace Business Starter is **$7/user/mo** annual or **$8.40** flexible
> ([GWS Business editions](https://knowledge.workspace.google.com/admin/getting-started/editions/business-editions)).
> SEG list prices vary by partner and region — treat table as planning numbers.

**Break-even:** Deliverability Pro at $99/mo/workspace → **3 subscribers** cover baseline
pool cost; 20+ subscribers = healthy margin.

---

## Prerequisites

Before starting the 1–2 week provisioning calendar:

- [ ] **Registrar account** — Namecheap, Cloudflare Registrar, Porkbun, etc.
- [ ] **Microsoft 365** — partner or direct billing; ability to create **separate tenants**
      per seed group (recommended).
- [ ] **Google Workspace** — admin account for secondary seeds (1 per SEG).
- [ ] **Business identity pack** for SEG signups: legal name, EIN, business address, phone
      for verification.
- [ ] **Budget approval** — ~$200/mo recurring + ~$150 one-time domain registration.
- [ ] **DNS access** — registrar or Cloudflare zone per domain.
- [ ] **Secure vault** — 1Password / Bitwarden / HSM for `seed-pool-config.json` and
      `SYSTEM_SEED_ENCRYPTION_KEY`.
- [ ] **Internal wiki** — for SEG setup screenshots (not committed to repo).

---

## Domain acquisition

### Domain selection principles

- Reasonable-sounding business names — not obvious canary farms.
- Vary TLDs: `.com`, `.net`, `.co`, `.io` mix.
- Vary naming patterns: two-word, three-word, abbreviated (`nova-corp-mail.com`).
- **Age 3–6 months** before first canary send — many SEGs downgrade very-new domains.
- **Avoid:** hyphenated 5+ character names, exact-match spam-alert words (`mail-test`,
  `inbox-check`), dictionary joins that scream "mail testing".

### 12 domain slots (fill in during purchase)

| #   | SEG        | Slot   | Domain (fill at purchase)             | Registrar | Purchased |
| --- | ---------- | ------ | ------------------------------------- | --------- | --------- |
| 1   | Proofpoint | seed 1 | TBD (candidate: `apex-mail.net`)      |           |           |
| 2   | Proofpoint | seed 2 | TBD (candidate: `nova-corp-mail.com`) |           |           |
| 3   | Proofpoint | seed 3 | TBD (candidate: `bright-office.co`)   |           |           |
| 4   | Mimecast   | seed 1 | TBD                                   |           |           |
| 5   | Mimecast   | seed 2 | TBD                                   |           |           |
| 6   | Mimecast   | seed 3 | TBD                                   |           |           |
| 7   | Barracuda  | seed 1 | TBD                                   |           |           |
| 8   | Barracuda  | seed 2 | TBD                                   |           |           |
| 9   | Barracuda  | seed 3 | TBD                                   |           |           |
| 10  | Cisco      | seed 1 | TBD                                   |           |           |
| 11  | Cisco      | seed 2 | TBD                                   |           |           |
| 12  | Cisco      | seed 3 | TBD                                   |           |           |

### Purchase step-by-step

1. Log in to registrar.
2. Search for domain matching selection principles above.
3. Purchase **1 year** with **WHOIS privacy** enabled.
4. Leave nameservers at registrar default (or Cloudflare) — MX changes come after SEG signup.
5. Record domain → slot mapping in the internal wiki.
6. **Do not** point MX at M365/Google yet if SEG will sit in front — SEG cutover comes later.

### Screenshots to capture (first time)

![screenshot: registrar cart with privacy enabled]  
![screenshot: domain list with purchase dates and renewal reminders]

---

## Mail host provisioning

### Microsoft 365 Business Basic

**Recommended for:** 2 seeds per SEG (strong M365 trust path for Proofpoint + Mimecast).

**List price:** $7/user/mo annual (as of 2026-07-01).

#### Step-by-step

1. **Create tenant** — [admin.microsoft.com](https://admin.microsoft.com) → sign up for a
   **new** organization per seed group (or per domain if budget allows).
   - **Rationale:** separate tenants = separate reputation; one bad seed does not drag others.
2. **Add + verify domain** — Admin center → Settings → Domains → Add domain.
   - Add DNS **TXT** verification record at registrar.
   - Wait for propagation (`dig TXT <domain>`).
3. **Assign license** — Users → Active users → add user with **Microsoft 365 Business Basic**.
   - Display name should look human (e.g. `Sarah Chen`).
   - Username: `sarah.chen@<domain>`.
4. **Enable IMAP** (required for canary polling):
   - **UI:** [Exchange admin center](https://admin.exchange.microsoft.com) → Recipients →
     Mailboxes → select mailbox → **Email apps settings** → enable **IMAP**.
   - **PowerShell (alternative):**

     ```powershell
     Connect-ExchangeOnline
     Set-CASMailbox sarah.chen@<domain> -IMAPEnabled $true
     ```

   ([Microsoft CAS mailbox protocol docs](https://learn.microsoft.com/en-us/microsoft-365/admin/add-users/remove-former-employee-step-7))

5. **Programmatic access** (pick one):
   - **Preferred:** OAuth via Nango (`microsoft` integration) — same pattern as customer
     mailboxes; no basic auth.
   - **Fallback:** app password / modern auth app registration if OAuth path is not yet wired
     for system seeds. Basic auth for Exchange Online is deprecated — do not rely on it for
     new tenants.
6. **Record IMAP settings** for `seed-pool-config.json`:
   - Host: `outlook.office365.com`
   - Port: `993` (SSL/TLS)
   - Username: full email address
   - Password: vault entry (encrypted at bootstrap)

#### Screenshots to capture

![screenshot: domain verified in M365 admin center]  
![screenshot: Exchange admin center — IMAP enabled for mailbox]

---

### Google Workspace Business Starter

**Recommended for:** 1 seed per SEG (provider variety = stronger signal).

**List price:** $7/user/mo annual, $8.40 flexible
([Business editions](https://knowledge.workspace.google.com/admin/getting-started/editions/business-editions)).

#### Step-by-step

1. Sign up at [workspace.google.com/business/signup](https://workspace.google.com/business/signup).
2. Verify domain via DNS TXT (Admin console → Account → Domains).
3. Create mailbox user (human-looking name).
4. **Enable IMAP** (org-wide or per-user):
   - Admin console → Apps → Google Workspace → Gmail → **End user access** →
     **IMAP access** → Enable.
   - Per-user: Gmail settings → Forwarding and POP/IMAP → Enable IMAP.
     ([Gmail IMAP settings API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/ImapSettings))
5. **Authentication (2025+ requirement):**
   - As of **2026-03-14**, Google disabled basic auth (username/password) for IMAP/POP/SMTP
     ([transition to OAuth](https://support.google.com/a/answer/14114704)).
   - **Preferred:** OAuth via Nango (`google-mail` integration) with `gmail.readonly` scope.
   - **Legacy fallback:** [app password](https://support.google.com/accounts/answer/185833)
     only if 2-Step Verification is on and the account is not Advanced Protection — not
     recommended for new seeds.
6. **IMAP settings** for config file:
   - Host: `imap.gmail.com`
   - Port: `993`
   - Username: full email
   - Password / OAuth: vault entry

#### Screenshots to capture

![screenshot: Admin console — IMAP enabled for organization]  
![screenshot: Nango connection test for google-mail seed]

---

## SEG subscription setup

Each SEG filters inbound mail **before** it reaches the tenant. Configure **inbound
routing** in the SEG console to deliver clean mail to the downstream host:

| Downstream       | Delivery target                                                    |
| ---------------- | ------------------------------------------------------------------ |
| Microsoft 365    | `<tenant>.mail.protection.outlook.com` (from M365 domain DNS page) |
| Google Workspace | `smtp.google.com` (both primary and alternate in Mimecast routing) |

**General DNS hygiene:**

- Lower MX TTL to **300–600** before cutover; restore to 86400 after stable.
- Remove **all** legacy MX records after cutover — leftover MX = bypass path.
- Update **SPF** to include SEG include + downstream (`spf.protection.outlook.com` or Google).
- Verify: `dig MX <domain> +short`

---

### Proofpoint Essentials

| Field             | Value                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sign up**       | [Proofpoint small business](https://www.proofpoint.com/us/products/small-business) — sold through partners; contact sales or authorized reseller |
| **Business info** | EIN, business address, phone verification                                                                                                        |
| **Cost**          | ~$2–5/user/mo, minimum ~3 seats                                                                                                                  |
| **Timeline**      | 3–7 business days activation                                                                                                                     |

#### MX configuration (US stack example)

Your assigned stack may differ — use values from **Account Management → Features** in
the Proofpoint console, not generic guesses.

| Type | Host | Value                    | Priority |
| ---- | ---- | ------------------------ | -------- |
| MX   | `@`  | `mx1-us1.ppe-hosted.com` | 0        |
| MX   | `@`  | `mx2-us1.ppe-hosted.com` | 1        |

EU stacks use `mx1-eu1.ppe-hosted.com` / `mx2-eu1.ppe-hosted.com`
([Proofpoint connection details](https://help.constantedge.com/support/solutions/articles/44002398693-connection-details)).

**SPF (add to existing record):** `include:_spf-us.ppe-hosted.com` (US) or
`include:_spf-eu.ppe-hosted.com` (EU).

**Filtering policy:** default enterprise-safety — block obvious spam, allow legitimate.
Do **not** tighten beyond default; seeds should resemble a normal user inbox.

**Inbound routing:** Proofpoint → M365 `*.mail.protection.outlook.com` (standard SEG-in-front
pattern). Enable outbound relay + connectors per Proofpoint's M365 cutover guide
([cut over mail flow](https://help.constantedge.com/support/solutions/articles/44002402471-step-6-cut-over-mail-flow-to-proofpoint)).

**Verify:**

```bash
dig MX apex-mail.net +short
# Expect only ppe-hosted.com hosts after cutover
```

#### Screenshots to capture

![screenshot: Proofpoint domain verified]  
![screenshot: Proofpoint inbound route to M365 protection endpoint]  
![screenshot: dig MX output post-cutover]

_Full gallery: [private wiki — Proofpoint seed setup]_

---

### Mimecast

| Field             | Value                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| **Sign up**       | [Mimecast Gateway](https://www.mimecast.com/products/gateway/) — 30-day trial, then ~$4–6/user/mo |
| **Business info** | EIN, business address                                                                             |
| **Timeline**      | 1–2 business days (trial)                                                                         |

#### MX configuration (United States)

| Type | Host | Value                            | Priority |
| ---- | ---- | -------------------------------- | -------- |
| MX   | `@`  | `us-smtp-inbound-1.mimecast.com` | 10       |
| MX   | `@`  | `us-smtp-inbound-2.mimecast.com` | 10       |

Both records **same priority** (round-robin). Other regions:
[Mimecast gateway configuration](https://mimecastsupport.zendesk.com/hc/en-us/articles/34000417366675).

**Filtering policy:** Managed Policies → Anti-Spoofing on, Anti-Impersonation on (typical
enterprise posture).

**Inbound routing:** Create delivery route in Mimecast admin → destination =
M365 protection hostname or Google `smtp.google.com`
([inbound email setup](https://mimecastsupport.zendesk.com/hc/en-us/articles/34000763883411)).

**Note:** M365 admin may show a domain health warning after MX points to Mimecast — expected;
safe to ignore if Mimecast validation passes.

#### Screenshots to capture

![screenshot: Mimecast Connect wizard — MX hostnames]  
![screenshot: Delivery routing definition to downstream tenant]

_Full gallery: [private wiki — Mimecast seed setup]_

---

### Barracuda Email Protection

| Field        | Value                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Sign up**  | [Barracuda Email Protection](https://www.barracuda.com/products/email-protection) — 30-day trial, then ~$3–8/user/mo |
| **Timeline** | ~1 business day                                                                                                      |

#### MX configuration

> **Important:** Barracuda assigns **account-specific** MX hostnames, not a shared
> `mx.essentialscloud.com`. Format: `<hash>a.ess.barracudanetworks.com` and
> `<hash>b.ess.barracudanetworks.com` (example hashes vary per account).

1. Log in to Barracuda admin → Domains → add domain → complete verification.
2. Copy **primary and backup MX** from the setup wizard (**Add new MX records** section).
3. **Staged cutover (recommended):**
   - Phase 1: add Barracuda MX at priority **99** (test).
   - Phase 2: after validation, set Barracuda MX to priority **1** and **10**, remove old MX.
     ([Barracuda MX setup wizard](https://campus.barracuda.com/product/emailgatewaydefense/doc/96018477/how-to-manage-mx-records-with-the-setup-wizard))

**SPF:** include regional `spf.ess.barracudanetworks.com` per console instructions.

**Filtering policy:** Advanced Threat Protection on; defaults elsewhere.

**Inbound routing:** Barracuda → M365 or Google tenant per wizard (**identify email server** step).

#### Screenshots to capture

![screenshot: Barracuda domain verification — unique MX hostnames]  
![screenshot: MX priority change after test phase]

_Full gallery: [private wiki — Barracuda seed setup]_

---

### Cisco Secure Email (Cloud Gateway)

| Field        | Value                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Sign up**  | Contact [Cisco Secure Email](https://www.cisco.com/c/en/us/products/security/email-security/index.html) sales — 30-day trial typical |
| **Cost**     | ~$5–10/user/mo (partner-sold)                                                                                                        |
| **Timeline** | 5–10 business days                                                                                                                   |

#### MX configuration

> **Important:** Use the **exact hostnames from your Cisco welcome / activation letter**.
> Generic `mx.iphmx.com` is wrong. Format example:
> `mx1.<allocation>.<region>.iphmx.com` and `mx2.<allocation>.<region>.iphmx.com`
> ([Cisco CES hostnames](https://docs.ces.cisco.com/docs/hostnames),
> [load balancer FAQ](https://docs.ces.cisco.com/docs/ces-load-balancer-faq)).

| Type | Host | Value                             | Priority |
| ---- | ---- | --------------------------------- | -------- |
| MX   | `@`  | `mx1.<your-allocation>.iphmx.com` | 10       |
| MX   | `@`  | `mx2.<your-allocation>.iphmx.com` | 10       |

**Regional suffixes:** US → `.iphmx.com`; EU → `.eu.iphmx.com`; APJ → `.ap.iphmx.com` (per
tenant allocation — **must match welcome letter region**).

**Filtering policy:** default SecureX / standard inbound policy.

**Inbound routing:** Cisco admin → Network → SMTP Routes → destination = downstream tenant MX.

#### Screenshots to capture

![screenshot: Cisco welcome letter — MX hostnames highlighted]  
![screenshot: SMTP route to M365 protection endpoint]

_Full gallery: [private wiki — Cisco seed setup]_

---

## Post-provisioning: seed onboarding to the app

### The config file

Path: `internal-runbooks/seed-pool-config.json` — **NOT COMMITTED**. Store in password
manager or secure vault; copy to runtime host at bootstrap.

Shape (see [seed-pool-config.example.json](./seed-pool-config.example.json)):

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
    "notes": "Provisioned 2026-08-15; Proofpoint stack US1; OAuth via Nango conn_abc"
  }
]
```

`gateway` values: `proofpoint` | `mimecast` | `barracuda` | `cisco` (must match
`gateway_type` enum in DB).

### Bootstrap script

Track PHI ships `scripts/seed-pool-bootstrap.ts`. It:

1. Reads JSON from `SEED_POOL_CONFIG_PATH`
2. Encrypts credentials with `SYSTEM_SEED_ENCRYPTION_KEY`
3. Upserts `seed_inbox` rows with `organization_id = NULL`

**Run once at initial pool provisioning** (from repo checkout on Systems bastion):

```bash
SEED_POOL_CONFIG_PATH=/secure/vault/seed-pool-config.json \
SYSTEM_SEED_ENCRYPTION_KEY="$(op read 'op://Quiksend Systems/seed-encryption-key/password')" \
DATABASE_URL="..." \
pnpm tsx scripts/seed-pool-bootstrap.ts
```

**Idempotent:** existing seeds match on `email` and update rather than duplicate.

### Verification after bootstrap

```sql
SELECT email, gateway, provider, pool_tag, active, created_at
FROM seed_inbox
WHERE organization_id IS NULL
ORDER BY gateway, email;
-- Expect 12 rows, all active, pool_tag = 'production'
```

Trigger `seed_inbox.verify` job (or wait for health cron) and confirm IMAP OK in worker logs.

---

## Ongoing operations

### Daily: seed pool health (manual until Wave 9 automation)

**No automated cron ships in Phase 11.** Run this manual weekly ops procedure until
`seed_pool.health_check` lands (Wave 9 / Track PHI2):

**Check for:**

- Any seed IMAP LOGIN fails
- Any seed has **< 5 non-canary messages** in 30 days (dormant → SEG downgrade risk)

#### Manual response

1. Log in to seed webmail (M365 OWA or Gmail).
2. **Auth broken:** reset password / refresh OAuth in Nango → update vault config → re-run
   bootstrap (idempotent update).
3. **Dormant:** subscribe seeds to 2–3 real newsletters; ensure legit-usage cron is enabled;
   see [seed-pool-legit-usage-patterns.md](./seed-pool-legit-usage-patterns.md).

### Weekly: legit-usage generator (manual until Wave 9 automation)

**No automated cron ships in Phase 11.** Until `seed_pool.generate_legit_mail` lands,
follow the manual patterns in
[seed-pool-legit-usage-patterns.md](./seed-pool-legit-usage-patterns.md):

- Cap **5 messages/seed/week**
- Vary content and send times
- Treat as light garnish, not bulk mail

### Monthly: domain age + reputation review

- Check canary arrival rate per `(mailbox_id, gateway)` in deliverability grid.
- If any domain's rate **< 60% for 7+ days** → start rotation (below).

### Every 6 months: credential rotation

Calendar reminder to rotate seed passwords / OAuth refresh tokens and re-bootstrap.

---

## Domain rotation (reputation degraded)

If a domain's canary delivery rate to its SEG drops below **60%** for **7+ consecutive days**:

1. Purchase replacement domain ([Domain acquisition](#domain-acquisition)).
2. Provision new mailbox + SEG routing (or add domain to existing SEG account).
3. **Age gate:** if possible, wait 3+ months before promoting to `production` pool tag;
   use `canary_only` tag during warm-up if supported.
4. Bootstrap new seed row; set old seed `active = false` in DB.
5. Park old domain **6 months** (no new mail) before letting registration expire.

---

## Cost tracking

| Category                     | Monthly (planning) |
| ---------------------------- | ------------------ |
| 12 mail seats @ $7           | $84                |
| 4 SEG subs (~$10–15 each)    | $40–60             |
| 12 domains amortized         | $12                |
| **Total baseline**           | **~$136–156**      |
| **Budget line (with drift)** | **~$200**          |

Track actuals in finance spreadsheet; link from internal wiki.

---

## Security considerations

| Topic             | Policy                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Encryption domain | Workspace mailboxes: `MAILBOX_ENCRYPTION_KEY`. System seeds: `SYSTEM_SEED_ENCRYPTION_KEY`. Keys **never** in same env. |
| Self-host         | No `SYSTEM_SEED_ENCRYPTION_KEY` — user-provided seeds only.                                                            |
| Audit             | All provider seed credential access logged as `seed_inbox_credential_access` (Track PHI).                              |
| Rotation          | Seed passwords / tokens every **6 months**.                                                                            |
| Compromise        | See [Emergency runbook](#emergency-runbook-pool-is-compromised).                                                       |

---

## Emergency runbook: pool is compromised

If a competitor fingerprints seeds and poisons signal:

1. **Immediately** deactivate all seeds for affected SEG:

   ```sql
   UPDATE seed_inbox SET active = false, updated_at = now()
   WHERE organization_id IS NULL AND gateway = '<seg>' AND active = true;
   ```

2. Purchase fresh domains + provision new tenants (**7–14 days** calendar).
3. Notify Pro-tier customers: _"Deliverability Pro data for [SEG] is degraded during seed
   rotation; expect noisier grid for ~2 weeks."_
4. **Do not** disclose specific seed addresses publicly.

---

## Appendix: SEG contact information

Fill in at first setup; master copy in **private wiki** (account IDs, support portals,
partner rep contacts).

| SEG                   | Sales / trial URL                                                         | Support portal                      | Quiksend account ID |
| --------------------- | ------------------------------------------------------------------------- | ----------------------------------- | ------------------- |
| Proofpoint Essentials | https://www.proofpoint.com/us/products/small-business                     | Partner portal (TBD)                | TBD                 |
| Mimecast              | https://www.mimecast.com/products/gateway/                                | https://mimecastsupport.zendesk.com | TBD                 |
| Barracuda             | https://www.barracuda.com/products/email-protection                       | https://campus.barracuda.com        | TBD                 |
| Cisco Secure Email    | https://www.cisco.com/c/en/us/products/security/email-security/index.html | https://docs.ces.cisco.com          | TBD                 |

---

## Appendix: provisioning checklist (per seed)

Use one copy per seed in the internal wiki.

- [ ] Domain purchased (WHOIS privacy on)
- [ ] Mail tenant created + domain verified
- [ ] Mailbox user created (human name)
- [ ] IMAP enabled / OAuth connected
- [ ] SEG account domain added + verified
- [ ] MX cutover complete (`dig MX` clean)
- [ ] Inbound route to downstream tenant tested (send test from external Gmail)
- [ ] Entry added to `seed-pool-config.json` in vault
- [ ] Bootstrap script run; `seed_inbox` row present
- [ ] `seed_inbox.verify` passed
- [ ] 3+ newsletters subscribed OR legit-usage cron confirmed
- [ ] Domain age noted (target: 3–6 months before heavy canary load)
