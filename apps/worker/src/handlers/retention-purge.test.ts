import { randomUUID } from "node:crypto";
import { db, listAuditLog } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { truncateAppTables, withTestOrgs } from "@quiksend/db/testing";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { runRetentionPurge } from "./retention-purge.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("runRetentionPurge", () => {
  beforeEach(async () => {
    await truncateAppTables();
  });

  it("purges events and webhook attempts past their retention window, org-agnostically", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const now = new Date();
      const old = new Date(now.getTime() - 200 * DAY_MS);
      const recent = new Date(now.getTime() - DAY_MS);

      await db.insert(tables.event).values([
        { organizationId: orgA.id, type: "test.old", entityType: "test", entityId: randomUUID(), createdAt: old },
        { organizationId: orgB.id, type: "test.old", entityType: "test", entityId: randomUUID(), createdAt: old },
        {
          organizationId: orgA.id,
          type: "test.recent",
          entityType: "test",
          entityId: randomUUID(),
          createdAt: recent,
        },
      ]);

      const [endpoint] = await db
        .insert(tables.webhookEndpoint)
        .values({ organizationId: orgA.id, url: "https://example.com/hook", secret: "s", events: ["message.sent"] })
        .returning();

      await db.insert(tables.webhookDelivery).values([
        {
          organizationId: orgA.id,
          endpointId: endpoint!.id,
          eventType: "message.sent",
          payload: {},
          createdAt: new Date(now.getTime() - 60 * DAY_MS),
        },
        { organizationId: orgA.id, endpointId: endpoint!.id, eventType: "message.sent", payload: {}, createdAt: recent },
      ]);

      const summary = await runRetentionPurge({ now });
      expect(summary.eventsDeleted).toBe(2);
      expect(summary.webhookAttemptsDeleted).toBe(1);

      const remainingEvents = await db.select().from(tables.event);
      expect(remainingEvents).toHaveLength(1);
      expect(remainingEvents[0]!.type).toBe("test.recent");
    });
  });

  it("never purges messages for an organization without a deletion request", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({ organizationId: orgA.id, ownerUserId: orgA.userId, provider: "smtp", address: "a@example.com" })
        .returning();
      await db.insert(tables.message).values({ organizationId: orgA.id, mailboxId: mailbox!.id });

      const summary = await runRetentionPurge({ now: new Date() });
      expect(summary.messagesDeleted).toBe(0);
      expect(await db.select().from(tables.message)).toHaveLength(1);
    });
  });

  it("never purges messages for an org whose deletion is still within the retention window", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const now = new Date();
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({ organizationId: orgA.id, ownerUserId: orgA.userId, provider: "smtp", address: "a@example.com" })
        .returning();
      await db.insert(tables.message).values({ organizationId: orgA.id, mailboxId: mailbox!.id });
      await db.insert(tables.organizationLifecycle).values({
        organizationId: orgA.id,
        deletionRequestedAt: new Date(now.getTime() - DAY_MS), // well inside the 365d default
        sendingDisabledAt: new Date(now.getTime() - DAY_MS),
      });

      const summary = await runRetentionPurge({ now });
      expect(summary.messagesDeleted).toBe(0);
      expect(await db.select().from(tables.message)).toHaveLength(1);
    });
  });

  it("purges a deleted org's messages in bounded batches, resumes across runs, and retains suppression + audit evidence", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const now = new Date();

      const [mailboxA] = await db
        .insert(tables.mailbox)
        .values({ organizationId: orgA.id, ownerUserId: orgA.userId, provider: "smtp", address: "a@example.com" })
        .returning();
      await db
        .insert(tables.message)
        .values(Array.from({ length: 5 }, () => ({ organizationId: orgA.id, mailboxId: mailboxA!.id })));

      // Org B is untouched by org A's deletion — must survive every assertion below.
      const [mailboxB] = await db
        .insert(tables.mailbox)
        .values({ organizationId: orgB.id, ownerUserId: orgB.userId, provider: "smtp", address: "b@example.com" })
        .returning();
      await db.insert(tables.message).values({ organizationId: orgB.id, mailboxId: mailboxB!.id });

      await db.insert(tables.suppression).values({
        organizationId: orgA.id,
        value: "gone@example.com",
        valueType: "email",
        reason: "unsubscribe",
      });

      await db.insert(tables.organizationLifecycle).values({
        organizationId: orgA.id,
        deletionRequestedAt: new Date(now.getTime() - 400 * DAY_MS),
        sendingDisabledAt: new Date(now.getTime() - 400 * DAY_MS),
      });

      // First run: bounded to 2 rows/batch, 1 batch/org — deletes only 2 of 5.
      const first = await runRetentionPurge({ now, batchSize: 2, maxBatchesPerOrg: 1 });
      expect(first.messagesDeleted).toBe(2);
      expect(first.organizationsPurgeCompleted).toBe(0);
      expect(
        await db.select().from(tables.message).where(eq(tables.message.organizationId, orgA.id)),
      ).toHaveLength(3);

      // Second run resumes from where the first left off and finishes.
      const second = await runRetentionPurge({ now, batchSize: 2, maxBatchesPerOrg: 5 });
      expect(second.messagesDeleted).toBe(3);
      expect(second.organizationsPurgeCompleted).toBe(1);
      expect(
        await db.select().from(tables.message).where(eq(tables.message.organizationId, orgA.id)),
      ).toHaveLength(0);

      // Org B's message was never touched.
      expect(
        await db.select().from(tables.message).where(eq(tables.message.organizationId, orgB.id)),
      ).toHaveLength(1);

      // Suppression hash retained as compliance evidence.
      expect(
        await db.select().from(tables.suppression).where(eq(tables.suppression.organizationId, orgA.id)),
      ).toHaveLength(1);

      // Purge completion recorded in the audit trail (minimal compliance evidence).
      const auditRows = await listAuditLog({ organizationId: orgA.id });
      expect(auditRows.some((r) => r.action === "organization.purge_completed")).toBe(true);

      const lifecycle = await db.query.organizationLifecycle.findFirst({
        where: eq(tables.organizationLifecycle.organizationId, orgA.id),
      });
      expect(lifecycle?.purgeCompletedAt).not.toBeNull();
    });
  });
});
