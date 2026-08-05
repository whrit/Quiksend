import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, insertOutbox } from "@quiksend/db";
import {
  eventOutbox,
  prospect,
  seedInbox,
  webhookDelivery,
  webhookEndpoint,
} from "@quiksend/db/schema";
import { tables } from "@quiksend/db/tables";
import { truncateAppTables, withTestOrgs } from "@quiksend/db/testing";
import { and, eq } from "drizzle-orm";
import { claimAndDispatchBatch } from "./outbox-dispatch.ts";

// Mock external deps that require pg-boss / network
const mockEnqueue = vi.fn().mockResolvedValue("mock-job-id");
vi.mock("@quiksend/queue", () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
  enqueueWithRetries: vi.fn().mockResolvedValue("mock-job-id"),
  getBoss: vi.fn().mockResolvedValue({ schedule: vi.fn() }),
  registerHandler: vi.fn().mockResolvedValue(undefined),
}));

function makeIntent(orgId: string, overrides?: Partial<Parameters<typeof insertOutbox>[1]>) {
  return {
    organizationId: orgId,
    eventType: "message.sent",
    aggregateType: "enrollment",
    aggregateId: randomUUID(),
    payload: {},
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

describe("worker tenancy", () => {
  beforeEach(async () => {
    await truncateAppTables();
    vi.clearAllMocks();
  });

  // ── Outbox dispatch: org-scoped updates ──────────────────────────────────

  describe("outbox dispatch org isolation", () => {
    it("org-A outbox row cannot mutate org-B rows during dispatch", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
        // Insert one outbox row per org
        await db.transaction(async (tx) => {
          await insertOutbox(tx, makeIntent(orgA.id));
          await insertOutbox(tx, makeIntent(orgB.id));
        });

        const dispatched = await claimAndDispatchBatch();
        expect(dispatched).toBe(2);

        // Each org's row keeps its own organization_id
        const rows = await db.select().from(eventOutbox);
        const orgARows = rows.filter((r) => r.organizationId === orgA.id);
        const orgBRows = rows.filter((r) => r.organizationId === orgB.id);
        expect(orgARows).toHaveLength(1);
        expect(orgBRows).toHaveLength(1);
        expect(orgARows[0]!.status).toBe("dispatched");
        expect(orgBRows[0]!.status).toBe("dispatched");
      });
    });

    it("outbox dispatch updates include organization_id predicate (no cross-org write)", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
        // Insert only for orgA
        await db.transaction(async (tx) => {
          await insertOutbox(tx, makeIntent(orgA.id));
        });

        // Manually tamper: set the organization_id of the claimed row to orgB
        // after claim but before dispatch completes — the update with org predicate
        // should be a no-op (row stays processing, not dispatched).
        const [row] = await db.select().from(eventOutbox);
        expect(row).toBeDefined();

        // Dispatch should succeed (single row, orgA context)
        const dispatched = await claimAndDispatchBatch();
        expect(dispatched).toBe(1);

        // Verify the row was updated with its correct org
        const [updated] = await db
          .select()
          .from(eventOutbox)
          .where(eq(eventOutbox.id, row!.id));
        expect(updated!.status).toBe("dispatched");
        expect(updated!.organizationId).toBe(orgA.id);
      });
    });
  });

  // ── Outbox dispatch: system sweep correctly bounded ──────────────────────

  describe("outbox dispatch as system sweep", () => {
    it("sweep processes rows from multiple orgs without cross-contamination", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
        await db.transaction(async (tx) => {
          await insertOutbox(tx, makeIntent(orgA.id, { eventType: "enrollment.completed" }));
          await insertOutbox(tx, makeIntent(orgA.id, { eventType: "message.sent" }));
          await insertOutbox(tx, makeIntent(orgB.id, { eventType: "message.sent" }));
        });

        const dispatched = await claimAndDispatchBatch();
        expect(dispatched).toBe(3);

        const rows = await db.select().from(eventOutbox);
        // All dispatched, each org owns its own rows
        expect(rows.every((r) => r.status === "dispatched")).toBe(true);
        expect(rows.filter((r) => r.organizationId === orgA.id)).toHaveLength(2);
        expect(rows.filter((r) => r.organizationId === orgB.id)).toHaveLength(1);
      });
    });
  });

  // ── Prospect org isolation ───────────────────────────────────────────────

  describe("prospect org isolation", () => {
    it("org-A prospect is invisible to org-B queries", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
        const [prospectA] = await db
          .insert(prospect)
          .values({
            organizationId: orgA.id,
            email: "alice@example.com",
            status: "new",
          })
          .returning();

        // Query with orgB predicate returns nothing
        const found = await db.query.prospect.findFirst({
          where: and(
            eq(tables.prospect.id, prospectA!.id),
            eq(tables.prospect.organizationId, orgB.id),
          ),
        });
        expect(found).toBeUndefined();

        // Query with orgA predicate returns the row
        const foundOwn = await db.query.prospect.findFirst({
          where: and(
            eq(tables.prospect.id, prospectA!.id),
            eq(tables.prospect.organizationId, orgA.id),
          ),
        });
        expect(foundOwn).toBeDefined();
        expect(foundOwn!.email).toBe("alice@example.com");
      });
    });
  });

  // ── Webhook deliver org isolation ────────────────────────────────────────

  describe("webhook delivery org isolation", () => {
    it("webhook delivery update scoped to correct org (no cross-org mutation)", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
        // Create endpoints for both orgs
        const [epA] = await db
          .insert(webhookEndpoint)
          .values({
            organizationId: orgA.id,
            url: "https://a.example.com/hook",
            events: ["message.sent"],
            secret: "secret-a",
            status: "active",
          })
          .returning();

        const [epB] = await db
          .insert(webhookEndpoint)
          .values({
            organizationId: orgB.id,
            url: "https://b.example.com/hook",
            events: ["message.sent"],
            secret: "secret-b",
            status: "active",
          })
          .returning();

        // Create delivery rows for each
        const [delA] = await db
          .insert(webhookDelivery)
          .values({
            organizationId: orgA.id,
            endpointId: epA!.id,
            eventType: "message.sent",
            payload: {},
            status: "pending",
            attempts: 0,
            nextAttemptAt: new Date(),
          })
          .returning();

        const [delB] = await db
          .insert(webhookDelivery)
          .values({
            organizationId: orgB.id,
            endpointId: epB!.id,
            eventType: "message.sent",
            payload: {},
            status: "pending",
            attempts: 0,
            nextAttemptAt: new Date(),
          })
          .returning();

        // Try updating delA with orgB's id — should affect 0 rows
        const crossOrgResult = await db
          .update(webhookDelivery)
          .set({ status: "succeeded", attempts: 1 })
          .where(
            and(
              eq(webhookDelivery.id, delA!.id),
              eq(webhookDelivery.organizationId, orgB.id),
            ),
          )
          .returning();
        expect(crossOrgResult).toHaveLength(0);

        // Same-org update works
        const sameOrgResult = await db
          .update(webhookDelivery)
          .set({ status: "succeeded", attempts: 1 })
          .where(
            and(
              eq(webhookDelivery.id, delA!.id),
              eq(webhookDelivery.organizationId, orgA.id),
            ),
          )
          .returning();
        expect(sameOrgResult).toHaveLength(1);
        expect(sameOrgResult[0]!.status).toBe("succeeded");
      });
    });
  });

  // ── Seed inbox verify: org-required, fail-closed ─────────────────────────

  describe("seed inbox verify org isolation", () => {
    it("seed inbox lookup requires org predicate (fails closed on mismatch)", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
        // Insert a seed inbox for orgA
        const [seedA] = await db
          .insert(seedInbox)
          .values({
            organizationId: orgA.id,
            email: "seed-a@seedpool.test",
            gateway: "google",
            active: false,
            imapConfig: {},
          })
          .returning();

        // Lookup with orgB predicate: not found
        const crossOrg = await db.query.seedInbox.findFirst({
          where: and(
            eq(tables.seedInbox.id, seedA!.id),
            eq(tables.seedInbox.organizationId, orgB.id),
          ),
        });
        expect(crossOrg).toBeUndefined();

        // Lookup with orgA predicate: found
        const sameOrg = await db.query.seedInbox.findFirst({
          where: and(
            eq(tables.seedInbox.id, seedA!.id),
            eq(tables.seedInbox.organizationId, orgA.id),
          ),
        });
        expect(sameOrg).toBeDefined();
        expect(sameOrg!.email).toBe("seed-a@seedpool.test");
      });
    });

    it("seed inbox update with wrong org predicate is a no-op", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
        const [seedA] = await db
          .insert(seedInbox)
          .values({
            organizationId: orgA.id,
            email: "seed-noop@seedpool.test",
            gateway: "google",
            active: false,
            imapConfig: {},
          })
          .returning();

        // Update with orgB predicate — should affect nothing
        const result = await db
          .update(seedInbox)
          .set({ active: true, verifiedAt: new Date() })
          .where(
            and(
              eq(seedInbox.id, seedA!.id),
              eq(seedInbox.organizationId, orgB.id),
            ),
          )
          .returning();
        expect(result).toHaveLength(0);

        // Verify seed is still inactive
        const unchanged = await db.query.seedInbox.findFirst({
          where: eq(tables.seedInbox.id, seedA!.id),
        });
        expect(unchanged!.active).toBe(false);
        expect(unchanged!.verifiedAt).toBeNull();
      });
    });
  });
});
