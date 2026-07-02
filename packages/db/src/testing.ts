import { randomUUID } from "node:crypto";
import { client, db } from "./client.ts";
import { member, organization, user } from "./schema/auth.ts";

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
  "webhook_delivery",
  "webhook_endpoint",
  "domain_event",
  "suppression",
  "api_key_usage",
  "research_profile",
  "value_prop",
  "job_log",
  "send_reservation",
  "task",
  "enrollment",
  "sequence_step",
  "sequence",
  "message",
  "mailbox",
  "sync_state",
  "crm_connection",
  "import_error",
  "import_batch",
  "list_member",
  "list",
  "prospect",
  "company",
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

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function createTestOrg(label: string): Promise<{ id: string; userId: string }> {
  const orgId = makeId("org");
  const userId = makeId("user");
  const memberId = makeId("member");
  const now = new Date();

  await db.insert(user).values({
    id: userId,
    name: `${label} User`,
    email: `${label}-${randomUUID().slice(0, 8)}@test.quiksend.local`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(organization).values({
    id: orgId,
    name: `${label} Workspace`,
    slug: `${label}-${randomUUID().slice(0, 8)}`,
    createdAt: now,
  });

  await db.insert(member).values({
    id: memberId,
    organizationId: orgId,
    userId,
    role: "owner",
    createdAt: now,
  });

  return { id: orgId, userId };
}

/**
 * Creates two isolated organizations with an owner member each, runs the callback,
 * then truncates app tables so the next test starts clean.
 */
export async function withTestOrgs<T>(fn: (orgs: TestOrgs) => Promise<T>): Promise<T> {
  await pingDb();
  const orgA = await createTestOrg("orgA");
  const orgB = await createTestOrg("orgB");
  try {
    return await fn({ orgA, orgB });
  } finally {
    await truncateAppTables();
  }
}
