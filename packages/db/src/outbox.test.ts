import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { eventOutbox } from "./schema/api.ts";
import { nangoWebhookProcessed } from "./schema/security.ts";
import { insertOutbox } from "./outbox.ts";
import { truncateAppTables, withTestOrgs } from "./testing.ts";

describe("insertOutbox", () => {
  beforeEach(async () => {
    await truncateAppTables();
  });

  it("crash after commit before enqueue: outbox row survives for sweep", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const idempotencyKey = randomUUID();

      // Simulate: source mutation + outbox in one tx, then crash (no enqueue)
      await db.transaction(async (tx) => {
        await insertOutbox(tx, {
          organizationId: orgA.id,
          eventType: "prospect.unsubscribed",
          aggregateType: "prospect",
          aggregateId: randomUUID(),
          payload: { email: "test@example.com" },
          idempotencyKey,
        });
      });
      // tx committed — simulate crash: no enqueue happens

      // The row is durable: a sweep can find and dispatch it
      const rows = await db
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.idempotencyKey, idempotencyKey));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("pending");
      expect(rows[0]!.attempts).toBe(0);
      expect(rows[0]!.eventType).toBe("prospect.unsubscribed");
    });
  });

  it("duplicate idempotency key for same event type is silently ignored", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const idempotencyKey = randomUUID();
      const intent = {
        organizationId: orgA.id,
        eventType: "enrollment.completed",
        aggregateType: "enrollment",
        aggregateId: randomUUID(),
        payload: { first: true },
        idempotencyKey,
      };

      const firstId = await db.transaction(async (tx) => insertOutbox(tx, intent));
      expect(firstId).not.toBe("");

      // Same idempotency key → no new row
      const secondId = await db.transaction(async (tx) =>
        insertOutbox(tx, { ...intent, payload: { first: false } }),
      );
      expect(secondId).toBe("");

      const rows = await db
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.idempotencyKey, idempotencyKey));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payload).toEqual({ first: true });
    });
  });

  it("same idempotency key with different event types are independent", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const key = randomUUID();
      const base = {
        organizationId: orgA.id,
        aggregateType: "enrollment",
        aggregateId: randomUUID(),
        payload: {},
        idempotencyKey: key,
      };

      const id1 = await db.transaction(async (tx) =>
        insertOutbox(tx, { ...base, eventType: "message.sent" }),
      );
      const id2 = await db.transaction(async (tx) =>
        insertOutbox(tx, { ...base, eventType: "enrollment.completed" }),
      );
      expect(id1).not.toBe("");
      expect(id2).not.toBe("");
      expect(id1).not.toBe(id2);
    });
  });

  it("Nango duplicate receipt produces one durable intent", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const nangoEventId = `nango_${randomUUID()}`;
      const connectionId = `conn_${randomUUID()}`;

      // First receipt: claim + outbox in one tx
      const firstClaimed = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(nangoWebhookProcessed)
          .values({ eventId: nangoEventId, connectionId })
          .onConflictDoNothing()
          .returning({ eventId: nangoWebhookProcessed.eventId });
        if (!row) return false;

        await insertOutbox(tx, {
          organizationId: orgA.id,
          eventType: "crm.sync",
          aggregateType: "crm_connection",
          aggregateId: connectionId,
          payload: { connectionId, model: "Contact" },
          idempotencyKey: nangoEventId,
        });
        return true;
      });
      expect(firstClaimed).toBe(true);

      // Second (duplicate) receipt: claim fails, no outbox
      const secondClaimed = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(nangoWebhookProcessed)
          .values({ eventId: nangoEventId, connectionId })
          .onConflictDoNothing()
          .returning({ eventId: nangoWebhookProcessed.eventId });
        if (!row) return false;

        await insertOutbox(tx, {
          organizationId: orgA.id,
          eventType: "crm.sync",
          aggregateType: "crm_connection",
          aggregateId: connectionId,
          payload: { connectionId, model: "Contact" },
          idempotencyKey: `${nangoEventId}_2`,
        });
        return true;
      });
      expect(secondClaimed).toBe(false);

      // Only one outbox row exists
      const rows = await db.select().from(eventOutbox);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.eventType).toBe("crm.sync");
    });
  });
});
