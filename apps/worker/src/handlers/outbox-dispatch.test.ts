import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@quiksend/db";
import { insertOutbox } from "@quiksend/db";
import { eventOutbox, webhookDelivery, webhookEndpoint } from "@quiksend/db/schema";
import { truncateAppTables, withTestOrgs } from "@quiksend/db/testing";
import { eq } from "drizzle-orm";
import {
  claimAndDispatchBatch,
  computeOutboxBackoff,
  MAX_OUTBOX_ATTEMPTS,
  OUTBOX_LEASE_SECONDS,
} from "./outbox-dispatch.ts";

// Mock enqueue so we don't need pg-boss running
const mockEnqueue = vi
  .fn<(...args: unknown[]) => Promise<string>>()
  .mockResolvedValue("mock-job-id");
vi.mock("@quiksend/queue", () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
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

describe("outbox dispatch", () => {
  beforeEach(async () => {
    await truncateAppTables();
    vi.clearAllMocks();
  });

  it("claims and dispatches pending rows, marking them dispatched", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.transaction(async (tx) => {
        await insertOutbox(tx, makeIntent(orgA.id));
        await insertOutbox(tx, makeIntent(orgA.id, { eventType: "enrollment.completed" }));
      });

      const dispatched = await claimAndDispatchBatch();
      expect(dispatched).toBe(2);

      const rows = await db.select().from(eventOutbox);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "dispatched")).toBe(true);
      expect(rows.every((r) => r.dispatchedAt !== null)).toBe(true);
      expect(rows.every((r) => r.claimedAt !== null)).toBe(true);
      expect(rows.every((r) => r.attempts === 1)).toBe(true);
    });
  });

  it("two concurrent dispatchers do not process the same row (SKIP LOCKED)", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.transaction(async (tx) => {
        await insertOutbox(tx, makeIntent(orgA.id));
      });

      const [a, b] = await Promise.all([claimAndDispatchBatch(), claimAndDispatchBatch()]);

      // Exactly one processes the row
      expect(a + b).toBe(1);

      const rows = await db.select().from(eventOutbox);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("dispatched");
    });
  });

  it("processing row is NOT re-claimed before lease expires (no early re-claim)", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const key = randomUUID();
      await db.transaction(async (tx) => {
        await insertOutbox(tx, makeIntent(orgA.id, { idempotencyKey: key }));
      });

      // First dispatch claims and transitions to processing
      // Simulate crash: manually set to processing with fresh claimed_at
      await db
        .update(eventOutbox)
        .set({
          status: "processing",
          attempts: 1,
          claimedAt: new Date(), // lease just started
        })
        .where(eq(eventOutbox.idempotencyKey, key));

      // Second dispatch should NOT pick it up — lease hasn't expired
      const dispatched = await claimAndDispatchBatch();
      expect(dispatched).toBe(0);

      const [row] = await db.select().from(eventOutbox).where(eq(eventOutbox.idempotencyKey, key));
      expect(row!.status).toBe("processing");
    });
  });

  it("stale processing row is recovered after lease expires", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const key = randomUUID();
      await db.transaction(async (tx) => {
        await insertOutbox(tx, makeIntent(orgA.id, { idempotencyKey: key }));
      });

      // Simulate a crashed dispatcher: processing with expired lease
      const expiredLease = new Date(Date.now() - (OUTBOX_LEASE_SECONDS + 10) * 1000);
      await db
        .update(eventOutbox)
        .set({
          status: "processing",
          attempts: 1,
          claimedAt: expiredLease,
          updatedAt: expiredLease,
        })
        .where(eq(eventOutbox.idempotencyKey, key));

      // Sweep recovers the stale row
      const dispatched = await claimAndDispatchBatch();
      expect(dispatched).toBe(1);

      const [row] = await db.select().from(eventOutbox).where(eq(eventOutbox.idempotencyKey, key));
      expect(row!.status).toBe("dispatched");
      expect(row!.attempts).toBe(2); // was 1, re-claimed increments to 2
    });
  });

  it("crash after claim before dispatch: row stays processing until lease expires", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const key = randomUUID();
      await db.transaction(async (tx) => {
        await insertOutbox(tx, makeIntent(orgA.id, { idempotencyKey: key }));
      });

      // Claim transitions to processing
      // Simulate by setting processing with recent claimed_at
      await db
        .update(eventOutbox)
        .set({
          status: "processing",
          attempts: 1,
          claimedAt: new Date(),
        })
        .where(eq(eventOutbox.idempotencyKey, key));

      // Immediate sweep cannot claim it (lease hasn't expired)
      expect(await claimAndDispatchBatch()).toBe(0);

      // Expire the lease
      const expired = new Date(Date.now() - (OUTBOX_LEASE_SECONDS + 1) * 1000);
      await db
        .update(eventOutbox)
        .set({ claimedAt: expired, updatedAt: expired })
        .where(eq(eventOutbox.idempotencyKey, key));

      // Now sweep recovers it
      expect(await claimAndDispatchBatch()).toBe(1);

      const [row] = await db.select().from(eventOutbox).where(eq(eventOutbox.idempotencyKey, key));
      expect(row!.status).toBe("dispatched");
    });
  });

  it("retry recovery: failed dispatch returns to pending with backoff", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const key = randomUUID();
      await db.transaction(async (tx) => {
        await insertOutbox(tx, makeIntent(orgA.id, { idempotencyKey: key }));
      });

      // Simulate a failed attempt: status=pending, attempts=1, recent updated_at
      await db
        .update(eventOutbox)
        .set({ attempts: 1, lastError: "queue down", status: "pending" })
        .where(eq(eventOutbox.idempotencyKey, key));

      // Backoff hasn't elapsed — updated_at is very recent
      await claimAndDispatchBatch();
      // May or may not claim depending on exact timing; force-expire backoff
      await db
        .update(eventOutbox)
        .set({ updatedAt: new Date(Date.now() - 120_000) })
        .where(eq(eventOutbox.idempotencyKey, key));

      const retried = await claimAndDispatchBatch();
      expect(retried).toBe(1);

      const [row] = await db.select().from(eventOutbox).where(eq(eventOutbox.idempotencyKey, key));
      expect(row!.status).toBe("dispatched");
    });
  });

  it("row at max attempts is marked failed and not retried", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const key = randomUUID();
      await db.transaction(async (tx) => {
        await insertOutbox(tx, makeIntent(orgA.id, { idempotencyKey: key }));
      });

      await db
        .update(eventOutbox)
        .set({ attempts: MAX_OUTBOX_ATTEMPTS, status: "failed", lastError: "exhausted" })
        .where(eq(eventOutbox.idempotencyKey, key));

      expect(await claimAndDispatchBatch()).toBe(0);

      const [row] = await db.select().from(eventOutbox).where(eq(eventOutbox.idempotencyKey, key));
      expect(row!.status).toBe("failed");
    });
  });

  it("partial endpoint failure: retry does not duplicate deliveries", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const key = randomUUID();
      await db.transaction(async (tx) => {
        await insertOutbox(
          tx,
          makeIntent(orgA.id, {
            eventType: "prospect.unsubscribed",
            idempotencyKey: key,
          }),
        );
      });

      // Create a webhook endpoint that subscribes to this event
      const [ep] = await db
        .insert(webhookEndpoint)
        .values({
          organizationId: orgA.id,
          url: "https://example.com/hook",
          secret: "test-secret",
          events: ["prospect.unsubscribed"],
          status: "active",
        })
        .returning({ id: webhookEndpoint.id });

      // First dispatch: creates delivery + enqueues
      expect(await claimAndDispatchBatch()).toBe(1);

      const deliveriesAfterFirst = await db
        .select()
        .from(webhookDelivery)
        .where(eq(webhookDelivery.endpointId, ep!.id));
      expect(deliveriesAfterFirst).toHaveLength(1);
      const firstDeliveryId = deliveriesAfterFirst[0]!.id;

      // Simulate crash after dispatch but before status update:
      // re-set to processing with expired lease
      const expired = new Date(Date.now() - (OUTBOX_LEASE_SECONDS + 1) * 1000);
      await db
        .update(eventOutbox)
        .set({
          status: "processing",
          attempts: 1,
          claimedAt: expired,
          updatedAt: expired,
          dispatchedAt: null,
        })
        .where(eq(eventOutbox.idempotencyKey, key));

      // Second dispatch: conflict-safe insert reuses existing delivery
      expect(await claimAndDispatchBatch()).toBe(1);

      const deliveriesAfterSecond = await db
        .select()
        .from(webhookDelivery)
        .where(eq(webhookDelivery.endpointId, ep!.id));
      expect(deliveriesAfterSecond).toHaveLength(1);
      expect(deliveriesAfterSecond[0]!.id).toBe(firstDeliveryId);

      // Enqueue was called with singletonKey both times
      const webhookCalls = mockEnqueue.mock.calls.filter(
        (c: unknown[]) => c[0] === "webhook.deliver",
      );
      expect(webhookCalls.length).toBeGreaterThanOrEqual(2);
      // All calls used the same singletonKey (= deliveryId)
      const keys = webhookCalls.map((c: unknown[]) => {
        const opts = c[2];
        if (opts && typeof opts === "object" && "singletonKey" in opts) {
          return opts.singletonKey;
        }
        return undefined;
      });
      expect(new Set(keys).size).toBe(1);
      expect(keys[0]).toBe(firstDeliveryId);
    });
  });

  it("post-dispatch crash: status update failure recovered by lease expiry", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const key = randomUUID();
      await db.transaction(async (tx) => {
        await insertOutbox(tx, makeIntent(orgA.id, { idempotencyKey: key }));
      });

      // First dispatch succeeds
      expect(await claimAndDispatchBatch()).toBe(1);
      const [dispatched] = await db
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.idempotencyKey, key));
      expect(dispatched!.status).toBe("dispatched");

      // Simulate: revert to processing as if the status=dispatched update never happened
      const expired = new Date(Date.now() - (OUTBOX_LEASE_SECONDS + 1) * 1000);
      await db
        .update(eventOutbox)
        .set({
          status: "processing",
          claimedAt: expired,
          updatedAt: expired,
          dispatchedAt: null,
        })
        .where(eq(eventOutbox.idempotencyKey, key));

      // Recovery sweep re-dispatches (idempotent downstream)
      expect(await claimAndDispatchBatch()).toBe(1);
      const [recovered] = await db
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.idempotencyKey, key));
      expect(recovered!.status).toBe("dispatched");
    });
  });

  it("backoff intervals grow exponentially", () => {
    expect(computeOutboxBackoff(0)).toBe(0);
    expect(computeOutboxBackoff(1)).toBe(30);
    expect(computeOutboxBackoff(2)).toBe(60);
    expect(computeOutboxBackoff(3)).toBe(120);
    expect(computeOutboxBackoff(10)).toBeLessThanOrEqual(3600);
  });
});
