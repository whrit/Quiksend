# Seed pool legit-usage email patterns

Templates for the `seed_pool.generate_legit_mail` weekly cron (Track PHI). Rotate through
these patterns across seeds. **Cap at 5 messages per seed per week.** Vary send times
(Tue–Thu mornings, occasional Friday afternoon).

Design rules:

- Transactional / internal-business tone — not marketing blasts.
- No spam-trigger phrases (FREE, ACT NOW, limited time, etc.).
- Sender addresses should look like colleagues at the seed domain or a plausible vendor.
- Subjects: short, specific, boring.
- Bodies: 2–6 sentences; plain text or minimal HTML.

---

## 1. Meeting notes (formal)

**From:** `alex.morgan@<seed-domain>`  
**To:** 1–2 other seeds in the same SEG group  
**Subject:** `Notes from Tuesday sync — Q3 pipeline`

```
Hi team,

Quick recap from today's sync:
- Pipeline review moved to Thursday 2pm ET.
- Finance needs the updated forecast by EOD Wednesday.
- I'll circulate the deck link before the call.

Thanks,
Alex
```

---

## 2. Weekly digest (friendly)

**From:** `ops-digest@<seed-domain>` (alias or shared mailbox if available)  
**To:** all seeds in tenant  
**Subject:** `Weekly ops digest — week of <date>`

```
Good morning,

This week's highlights:
- Deploy completed Sunday 03:00 UTC (no customer impact).
- Two support tickets closed; one open re: SSO timeout.
- Office closed Monday for the holiday.

Reply if anything looks off.

— Ops
```

---

## 3. Invoice reminder (brief)

**From:** `accounts@<seed-domain>`  
**To:** single seed  
**Subject:** `Invoice #INV-20481 — due Friday`

```
Hello,

Friendly reminder that invoice INV-20481 ($1,240.00) is due this Friday.
PDF attached in the billing portal; let us know if you need a PO number updated.

Accounts Receivable
```

---

## 4. Calendar invite (transactional)

**From:** `jordan.lee@<seed-domain>`  
**To:** 1 seed  
**Subject:** `Invitation: Design review @ Thu 11:00am`

```
You're invited to a 30-minute design review.

When: Thursday 11:00–11:30am (your local timezone)
Where: Google Meet / Teams link in calendar attachment

Agenda: final mockups for the onboarding flow.

— Jordan
```

_(Cron should emit an `.ics` attachment or calendar MIME part; auto-accept on recipient seeds.)_

---

## 5. Newsletter subscription confirmation

**From:** `noreply@industry-weekly.example` (external-looking vendor domain — use a real
low-volume newsletter you subscribed to manually, or simulate with an internal template
only if the cron supports external From domains)

**To:** seed  
**Subject:** `You're subscribed to Industry Weekly`

```
Thanks for subscribing to Industry Weekly.

You'll receive one email each Wednesday. Manage preferences:
https://example.com/preferences/<token>

To unsubscribe, use the link at the bottom of any issue.
```

_Prefer real newsletter subscriptions during initial provisioning; use this template only
as a fallback for the generator._

---

## 6. Project status update (formal)

**From:** `pmo@<seed-domain>`  
**To:** 2 seeds  
**Subject:** `Project Atlas — status update (green)`

```
Project Atlas status as of <date>:

- Milestone 2 complete; UAT starts Monday.
- Risk: vendor API rate limits — mitigation in progress.
- Next steering committee: 3/15 4pm ET.

Questions welcome before then.

PMO
```

---

## 7. Internal announcement (friendly)

**From:** `people@<seed-domain>`  
**To:** all seeds in tenant  
**Subject:** `Updated PTO policy — effective April 1`

```
Hi everyone,

We've posted an updated PTO policy in the employee handbook (link in HR portal).
Key change: unused PTO rolls up to 5 days into the next year.

Office hours with HR: Friday 1–2pm if you have questions.

People team
```

---

## 8. Colleague check-in (casual)

**From:** `sam.patel@<seed-domain>`  
**To:** 1 seed  
**Subject:** `Quick question on the deck`

```
Hey — did you get a chance to look at slide 12 in the board deck? I want to make sure
the churn numbers match what finance sent last week.

No rush; just before Thursday's prep.

Sam
```

---

## 9. Vendor shipping notice (brief)

**From:** `shipping@office-supplies.example`  
**To:** seed  
**Subject:** `Order #OS-8821 shipped`

```
Your order #OS-8821 has shipped.

Carrier: UPS
Tracking: 1Z999AA10123456784
Expected delivery: 2–3 business days.

Questions? Reply to this email or call 1-800-555-0199.
```

---

## 10. IT password expiry notice (formal, no links)

**From:** `it-notifications@<seed-domain>`  
**To:** seed  
**Subject:** `Password expires in 14 days`

```
This is a reminder that your network password expires in 14 days.

Please update your password before <date> using the standard SSO portal. If you need
help, open a ticket in the IT helpdesk.

IT Service Desk
```

_Do not include phishing-style links; point to known internal hostnames only._

---

## Rotation matrix (suggested)

| Week | Seed group    | Patterns to use                                           |
| ---- | ------------- | --------------------------------------------------------- |
| 1    | Proofpoint ×3 | 1, 4, 8                                                   |
| 1    | Mimecast ×3   | 2, 6, 9                                                   |
| 1    | Barracuda ×3  | 3, 7, 8                                                   |
| 1    | Cisco ×3      | 2, 5, 10                                                  |
| 2    | All           | Rotate — no seed gets the same pattern two weeks in a row |

Track PHI's cron should pick templates by `seed_id % 10` with a weekly offset to avoid
synchronized content across the pool.
