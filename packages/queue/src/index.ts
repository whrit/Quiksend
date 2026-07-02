/**
 * `@quiksend/queue` — pg-boss wrapper + typed job registry.
 *
 * pg-boss is Postgres-backed, so no new infrastructure — it shares the DB the
 * app already uses. This package owns:
 *   • boot: schema install (`pgboss` schema) + a single long-lived instance
 *   • job names (namespaced: `sequence.*`, `mailbox.*`, `crm.*`, `webhook.*`, `ai.*`)
 *   • typed producer helper (`enqueue(job, payload)`)
 *   • worker registration helper (`registerHandler(job, fn)`)
 *
 * apps/worker composes these into `main()` (Phase 6 tick + Phase 4/7 pollers).
 * apps/web enqueues (never registers a handler).
 */
export * from "./jobs.ts";
export * from "./boss.ts";
