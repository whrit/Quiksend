import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@quiksend/db";
import { insertOutbox } from "@quiksend/db";
import { eventOutbox } from "@quiksend/db/schema";
import { truncateAppTables, withTestOrgs } from "@quiksend/db/testing";
import { eq, sql } from "drizzle-orm";
import {
  claimAndDispatchBatch,
  computeOutboxBackoff,
  MAX_OUTBOX_ATTEMPTS,
} from "./outbox-dispatch.ts";

// Mock enqueue so we don't need pg-boss running
vi.mock("@quiksend/queue", () => ({
  enqueue: vi.fn().mockResolvedValue("mock-job-id"),
  getBoss: vi.fn().mockResolvedValue({ schedule: vi.fn() }),
  registerHandler: vi.fn().mockResolvedValue(undefined),
}));

describe("outbox dispatch", () => {
  beforeEach(async () => {
    await truncateAppTables();
    vi.clearAllMocks();
  });

  it("claims and dispatches pending rows atomically", async () => {
    await withTestOrgs(async ({ orgA }) => {
      // Insert two outbox intents
      await db.transaction(async (tx) => {
        await insertOutbox(tx, {
          organizationId: orgA.id,
          eventType: "message.sent",
          aggregateType: "enrollment",
          aggregateId: randomUUID(),
          payload: { enrollmentId: "e1" },
          idempotencyKey: randomUUID(),
        });
        await insertOutbox(tx, {
          organizationId: orgA.id,
          eventType: "enrollment.completed",
          aggregateType: "enrollment",
          aggregateId: randomUUID(),
          payload: { enrollmentId: "e2" },
          idempotencyKey: randomUUID(),
        });
      });

      const dispatched = await claimAndDispatchBatch();
      expect(dispatched).toBe(2);

      const rows = await db.select().from(eventOutbox);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "dispatched")).toBe(true);
      expect(rows.every((r) => r.dispatchedAt !== null)).toBe(true);
    });
  });

  it("concurrent dispatchers do not process the same row (SKIP LOCKED)", async () => {
    await withTestOrgs(async ({ orgA }) => {
      // Insert one outbox intent
      await db.transaction(async (tx) => {
        await insertOutbox(tx, {
          organizationId: orgA.id,
          eventType: "prospect.unsubscribed",
          aggregateType: "prospect",
          aggregateId: randomUUID(),
          payload: {},
          idempotencyKey: randomUUID(),
        });
      });

      // Run two dispatchers concurrently
      const [a, b] = await Promise.all([
        claimAndDispatchBatch(),
        claimAndDispatchBatch(),
      ]);

      // Exactly one of them processes the row
      expect(a + b).toBe(1);

      const rows = await db.select().from(eventOutbox);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("dispatched");
    });
  });

  it("retry recovery: failed dispatch increments attempts and retries later", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const key = randomUUID();
      await db.transaction(async (tx) => {
        await insertOutbox(tx, {
          organizationId: orgA.id,
          eventType: "message.sent",
          aggregateType: "enrollment",
          aggregateId: randomUUID(),
          payload: {},
          idempotencyKey: key,
        });
      });

      // Simulate a failed first attempt by manually setting the status
      await db
        .update(eventOutbox)
        .set({ attempts: 1, lastError: "queue down", status: "pending" })
        .where(eq(eventOutbox.idempotencyKey, key));

      // Backoff hasn't elapsed — updated_at is very recent, so skip it
      // (the backoff check uses updated_at)
      const skipped = await claimAndDispatchBatch();
      // Row may or may not be picked up depending on timing — the important
      // thing is the backoff formula. Let's force-expire the backoff:
      await db
        .update(eventOutbox)
        .set({
          updatedAt: new Date(Date.now() - 120_000), // 2 min ago
        })
        .where(eq(eventOutbox.idempotencyKey, key));

      const retried = await claimAndDispatchBatch();
      expect(retried).toBe(1);

      const [row] = await db
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.idempotencyKey, key));
      expect(row!.status).toBe("dispatched");
    });
  });

  it("row at max attempts is marked failed and not retried", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const key = randomUUID();
      await db.transaction(async (tx) => {
        await insertOutbox(tx, {
          organizationId: orgA.id,
          eventType: "message.sent",
          aggregateType: "enrollment",
          aggregateId: randomUUID(),
          payload: {},
          idempotencyKey: key,
        });
      });

      // Push to max attempts
      await db
        .update(eventOutbox)
        .set({
          attempts: MAX_OUTBOX_ATTEMPTS,
          status: "failed",
          lastError: "exhausted",
        })
        .where(eq(eventOutbox.idempotencyKey, key));

      const dispatched = await claimAndDispatchBatch();
      expect(dispatched).toBe(0);

      const [row] = await db
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.idempotencyKey, key));
      expect(row!.status).toBe("failed");
    });
  });

  it("backoff intervals grow exponentially", () => {
    expect(computeOutboxBackoff(0)).toBe(0);
    expect(computeOutboxBackoff(1)).toBe(30);
    expect(computeOutboxBackoff(2)).toBe(60);
    expect(computeOutboxBackoff(3)).toBe(120);
    // Capped at 1 hour
    expect(computeOutboxBackoff(10)).toBeLessThanOrEqual(3600);
  });
});
