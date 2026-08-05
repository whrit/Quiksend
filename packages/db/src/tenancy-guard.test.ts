import { describe, expect, it } from "vitest";
import { client } from "./client.ts";
import { withTenantTransaction, type DbTx } from "./tenant-context.ts";

/**
 * Tenancy CI guard — structural assertions on the RLS policy layer and the
 * tenant transaction contract. Replaces the earlier regex-based organizationId
 * check with a database-level guarantee: every scoped table MUST have a
 * `tenant_isolation` policy for `quiksend_app`, and the
 * `withTenantTransaction` function satisfies the protected-function contract.
 */

/**
 * Complete inventory of tenant-scoped tables. Every table here MUST have an
 * RLS policy named `tenant_isolation` enforced for the `quiksend_app` role.
 *
 * Categories:
 *   Direct — has `organization_id` column, equality check.
 *   Membership — auth table scoped via member.user_id (apikey).
 *   Indirect — no org_id, scoped via parent FK (list_member, import_error,
 *              send_reservation).
 *
 * Unscoped tables (no RLS): user, session, account, verification,
 * organization, app_meta, auth_rate_bucket, nango_webhook_processed,
 * gateway_classification, job_log.
 */
const RLS_SCOPED_TABLES: readonly string[] = [
  // Auth (Better Auth org plugin)
  "member",
  "invitation",
  "apikey",
  // Prospects & companies
  "company",
  "prospect",
  "list",
  "list_member",
  "import_batch",
  "import_error",
  // CRM
  "crm_connection",
  "sync_state",
  // Mailbox & messages
  "mailbox",
  "message",
  // Sequences
  "sequence",
  "sequence_step",
  "enrollment",
  "send_reservation",
  // AI
  "value_prop",
  "research_profile",
  "generation",
  // Tasks
  "task",
  // API & webhooks
  "api_key_usage",
  "webhook_endpoint",
  "webhook_delivery",
  "event_outbox",
  // Writeback & events
  "crm_writeback_log",
  "event",
  // Suppression
  "suppression",
  // Deliverability
  "seed_inbox",
  "canary_send",
  "deliverability_snapshot",
];

describe("tenancy guard", () => {
  it("every scoped table has a tenant_isolation RLS policy", async () => {
    const result = await client`
      SELECT tablename
      FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname = 'tenant_isolation'
    `;
    const tablesWithPolicy = new Set(
      result.map((r) => r["tablename"] as string),
    );

    const missing = RLS_SCOPED_TABLES.filter((t) => !tablesWithPolicy.has(t));
    expect(missing).toEqual([]);
  });

  it("no scoped table is missing from the inventory", async () => {
    // Cross-check: every table with RLS enabled should appear in our list.
    const result = await client`
      SELECT relname
      FROM pg_class
      WHERE relrowsecurity = true
        AND relnamespace = 'public'::regnamespace
    `;
    const rlsEnabled = new Set(
      result.map((r) => r["relname"] as string),
    );
    const inventory = new Set(RLS_SCOPED_TABLES);
    const unlisted = [...rlsEnabled].filter((t) => !inventory.has(t));
    expect(unlisted).toEqual([]);
  });

  it("withTenantTransaction satisfies the protected-function contract", () => {
    // Type-level check: (organizationId, fn) → Promise<T>.
    const _check: (
      orgId: string,
      fn: (tx: DbTx) => Promise<void>,
    ) => Promise<void> = withTenantTransaction;
    expect(typeof _check).toBe("function");
    expect(_check.length).toBe(2);
  });
});
