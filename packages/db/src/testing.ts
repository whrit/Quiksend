import { client } from "./client.ts";

/**
 * Test-only helpers. In real tests, `pnpm test` runs against the CI Postgres
 * service (see .github/workflows/ci.yml). Each test acquires its own scoped
 * data via `withTestOrgs()` (added in Phase 2) which:
 *   • creates two organizations + a member each
 *   • yields their ids
 *   • truncates every app-scoped table between tests
 *
 * Phase 2 wires the truncation list; today the harness exists so downstream
 * tests can import it without touching each other's schema.
 */
export interface TestOrgs {
  readonly orgA: { id: string; userId: string };
  readonly orgB: { id: string; userId: string };
}

/**
 * Names of app-scoped tables truncated between tests. Empty until Phase 2 adds
 * `prospect`/`company`/`list`; Phase 4 adds `mailbox`/`message`; etc.
 */
export const APP_SCOPED_TABLES_TO_TRUNCATE: readonly string[] = [
  "message",
  "mailbox",
  // "prospect" — Track 2 adds when its table lands.
];

export async function truncateAppTables(): Promise<void> {
  if (APP_SCOPED_TABLES_TO_TRUNCATE.length === 0) return;
  const list = APP_SCOPED_TABLES_TO_TRUNCATE.join(", ");
  await client.unsafe(`truncate table ${list} restart identity cascade`);
}

/** Convenience for tests: pings the DB so failing setup fails fast. */
export async function pingDb(): Promise<void> {
  await client`select 1`;
}

/** Manual close hook for test cleanup — pnpm test's process exit also drops the pool. */
export async function closeTestDb(): Promise<void> {
  await client.end();
}
