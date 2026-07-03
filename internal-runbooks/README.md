# Internal runbooks

Operational documentation for **Quiksend Systems** — the team that operates hosted-tier
infrastructure. These files are **not** shipped to end users and are **not** a substitute
for `docs/`, which covers self-hosting and product setup for customers.

## What lives here

| File                                                                     | Purpose                                                                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [seed-pool-setup.md](./seed-pool-setup.md)                               | Full runbook: acquire domains, provision mailboxes, subscribe to SEGs, bootstrap the Deliverability Pro seed pool |
| [seed-pool-legit-usage-patterns.md](./seed-pool-legit-usage-patterns.md) | Email templates for the weekly legit-usage generator cron                                                         |
| [seed-pool-config.example.json](./seed-pool-config.example.json)         | Example shape of the per-seed config file (fake data only)                                                        |

## Secrets policy

- **Never commit** real credentials, IMAP passwords, or production config to this repo.
- Production config lives at `seed-pool-config.json` (gitignored) in a password manager or
  separate secure vault.
- This directory may **reference** where secrets are stored; it must not contain them.
- Rotate seed credentials on the schedule in [seed-pool-setup.md](./seed-pool-setup.md#security-considerations).

## When to add a new runbook

Add a new `.md` file here when Quiksend Systems needs a repeatable procedure for a
hosted-only feature (billing ops, provider pools, incident response playbooks, etc.).
Update this README index when you do.
