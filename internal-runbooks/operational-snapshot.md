# Operational Snapshot — Beta Runbook

## Overview

The `ops.snapshot` job runs every 2 minutes via pg-boss cron. It queries
bounded aggregates across core tables and emits a structured log line
(`event: "ops.snapshot"`) with fixed numeric keys. No sensitive data (IDs,
emails, org names) is ever included.

Threshold alerts fire once per metric breach and suppress repeats until the
metric recovers below threshold, at which point a recovery notice is logged
and the next breach will alert again.

Alert state is in-memory; a worker restart clears it (first post-restart
breach will re-alert, which is correct).

## Beta Thresholds and Response Actions

| Metric                       | Threshold | What it means                                     | Response                                                                   |
| ---------------------------- | --------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `queueAgeMinutes`            | 60        | Oldest pending/queued message is >1 hour old      | Check pg-boss queue health; verify sequence.tick cron is running           |
| `stuckSendingCount`          | 5         | >5 messages stuck in 'sending' for >30 min        | Check mail provider connectivity; inspect message errors in DB             |
| `staleEnrollmentCount`       | 20        | >20 active enrollments with no update in >2 hours | Verify sequence.tick is scheduling steps; check for deadlocked enrollments |
| `mailboxPollLagMinutes`      | 30        | No mailbox poll completed in >30 min              | Check mailbox.poll.tick cron; verify IMAP/OAuth credentials                |
| `webhookBacklogCount`        | 50        | >50 pending webhook deliveries older than 10 min  | Check webhook.deliver handler; verify endpoint connectivity                |
| `inboundFailureCount`        | 10        | >10 inbound message failures in last hour         | Check inbound parsing; review bounce/failure reasons                       |
| `reconciliationFailureCount` | 3         | >3 failed health.reconcile jobs in last hour      | Check health-reconcile handler logs; review DB connectivity                |

## Log Events

| Event                | Level | Meaning                                 |
| -------------------- | ----- | --------------------------------------- |
| `ops.snapshot`       | info  | Normal snapshot emission (every 2 min)  |
| `ops.alert.breach`   | warn  | Metric crossed threshold for first time |
| `ops.alert.recovery` | info  | Metric returned below threshold         |

## Searching Logs

```bash
# All snapshots
grep '"event":"ops.snapshot"' /var/log/worker.log

# Active alerts only
grep '"event":"ops.alert.breach"' /var/log/worker.log

# Recovery notices
grep '"event":"ops.alert.recovery"' /var/log/worker.log
```

## Tuning Thresholds

Thresholds are constants in `apps/worker/src/operational-snapshot.ts` in the
`THRESHOLDS` object. Adjust for production load; beta values are conservative
starting points.
