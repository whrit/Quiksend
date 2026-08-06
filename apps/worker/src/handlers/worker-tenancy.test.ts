import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, insertOutbox } from "@quiksend/db";
import {
  eventOutbox,
  prospect,
  researchProfile,
  seedInbox,
  webhookDelivery,
  webhookEndpoint,
} from "@quiksend/db/schema";
import { tables } from "@quiksend/db/tables";
import { truncateAppTables, withTestOrgs } from "@quiksend/db/testing";
import { and, eq } from "drizzle-orm";
import { claimAndDispatchBatch } from "./outbox-dispatch.ts";

// Mock pg-boss / network deps
const mockEnqueue = vi
  .fn<(...args: unknown[]) => Promise<string>>()
  .mockResolvedValue("mock-job-id");
vi.mock("@quiksend/queue", () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
  enqueueWithRetries: vi
    .fn<(...args: unknown[]) => Promise<string>>()
    .mockResolvedValue("mock-job-id"),
  getBoss: vi
    .fn<() => Promise<{ schedule: () => Promise<unknown> }>>()
    .mockResolvedValue({ schedule: vi.fn<() => Promise<unknown>>() }),
  registerHandler: vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
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

  // ── Outbox dispatch: org-scoped claim + updates ─────────────────────────

  describe("outbox dispatch org isolation", () => {
    it("org-A outbox row cannot mutate org-B rows during dispatch", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
        await db.transaction(async (tx) => {
          await insertOutbox(tx, makeIntent(orgA.id));
          await insertOutbox(tx, makeIntent(orgB.id));
        });

        const dispatched = await claimAndDispatchBatch();
        expect(dispatched).toBe(2);

        const rows = await db.select().from(eventOutbox);
        const orgARows = rows.filter((r) => r.organizationId === orgA.id);
        const orgBRows = rows.filter((r) => r.organizationId === orgB.id);
        expect(orgARows).toHaveLength(1);
        expect(orgBRows).toHaveLength(1);
        expect(orgARows[0]!.status).toBe("dispatched");
        expect(orgBRows[0]!.status).toBe("dispatched");
      });
    });

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
        expect(rows.every((r) => r.status === "dispatched")).toBe(true);
        expect(rows.filter((r) => r.organizationId === orgA.id)).toHaveLength(2);
        expect(rows.filter((r) => r.organizationId === orgB.id)).toHaveLength(1);
      });
    });
  });

  // ── AI research: org mismatch at DB level ───────────────────────────────

  describe("ai research org isolation", () => {
    it("prospect query with mismatched org returns nothing (fail closed)", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
        const [prospectA] = await db
          .insert(prospect)
          .values({
            organizationId: orgA.id,
            email: "research-target@example.com",
            status: "new",
          })
          .returning();

        // Handler pattern: prospect lookup scoped by payload organizationId
        const found = await db.query.prospect.findFirst({
          columns: { id: true, organizationId: true },
          where: and(
            eq(tables.prospect.id, prospectA!.id),
            eq(tables.prospect.organizationId, orgB.id),
          ),
        });
        // Mismatched org → not found → handler skips (fail closed)
        expect(found).toBeUndefined();

        // Same org → found
        const correct = await db.query.prospect.findFirst({
          columns: { id: true, organizationId: true },
          where: and(
            eq(tables.prospect.id, prospectA!.id),
            eq(tables.prospect.organizationId, orgA.id),
          ),
        });
        expect(correct).toBeDefined();
        expect(correct!.organizationId).toBe(orgA.id);
      });
    });

    it("research profile upsert/update scoped by organizationId (no cross-org leak)", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
        const [prospectA] = await db
          .insert(prospect)
          .values({
            organizationId: orgA.id,
            email: "profile-test@example.com",
            status: "new",
          })
          .returning();

        // Create profile for orgA (as buildProfile does)
        await db.insert(researchProfile).values({
          organizationId: orgA.id,
          prospectId: prospectA!.id,
          status: "ready",
          facts: [],
          sources: [],
          summary: "test summary",
        });

        // Update with wrong org → 0 rows affected
        const crossResult = await db
          .update(researchProfile)
          .set({ status: "error", error: "should not happen" })
          .where(
            and(
              eq(researchProfile.organizationId, orgB.id),
              eq(researchProfile.prospectId, prospectA!.id),
            ),
          )
          .returning();
        expect(crossResult).toHaveLength(0);

        // Profile still "ready" (orgA owns it)
        const profile = await db.query.researchProfile.findFirst({
          where: and(
            eq(tables.researchProfile.organizationId, orgA.id),
            eq(tables.researchProfile.prospectId, prospectA!.id),
          ),
        });
        expect(profile!.status).toBe("ready");
        expect(profile!.error).toBeNull();

        // orgB has no profile for this prospect
        const crossProfile = await db.query.researchProfile.findFirst({
          where: and(
            eq(tables.researchProfile.organizationId, orgB.id),
            eq(tables.researchProfile.prospectId, prospectA!.id),
          ),
        });
        expect(crossProfile).toBeUndefined();
      });
    });
  });

  // ── Webhook deliver org isolation ────────────────────────────────────────

  describe("webhook delivery org isolation", () => {
    it("webhook delivery update scoped to correct org (no cross-org mutation)", async () => {
      await withTestOrgs(async ({ orgA, orgB }) => {
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

        // Cross-org update — 0 rows
        const crossOrgResult = await db
          .update(webhookDelivery)
          .set({ status: "succeeded", attempts: 1 })
          .where(and(eq(webhookDelivery.id, delA!.id), eq(webhookDelivery.organizationId, orgB.id)))
          .returning();
        expect(crossOrgResult).toHaveLength(0);

        // Same-org update works
        const sameOrgResult = await db
          .update(webhookDelivery)
          .set({ status: "succeeded", attempts: 1 })
          .where(and(eq(webhookDelivery.id, delA!.id), eq(webhookDelivery.organizationId, orgA.id)))
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

        // Cross-org: not found
        const crossOrg = await db.query.seedInbox.findFirst({
          where: and(
            eq(tables.seedInbox.id, seedA!.id),
            eq(tables.seedInbox.organizationId, orgB.id),
          ),
        });
        expect(crossOrg).toBeUndefined();

        // Same-org: found
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

        // Cross-org update — no effect
        const result = await db
          .update(seedInbox)
          .set({ active: true, verifiedAt: new Date() })
          .where(and(eq(seedInbox.id, seedA!.id), eq(seedInbox.organizationId, orgB.id)))
          .returning();
        expect(result).toHaveLength(0);

        const unchanged = await db.query.seedInbox.findFirst({
          where: eq(tables.seedInbox.id, seedA!.id),
        });
        expect(unchanged!.active).toBe(false);
        expect(unchanged!.verifiedAt).toBeNull();
      });
    });
  });
});
