import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import type { CrmWritebackPayload } from "@quiksend/queue";
import { registerCrmWritebackHandler } from "./crm-writeback.ts";

const nangoMocks = vi.hoisted(() => ({
  logSalesforceTask: vi.fn<() => Promise<{ externalId: string; response: unknown }>>(),
  logHubspotEngagement: vi.fn<() => Promise<{ externalId: string; response: unknown }>>(),
  upsertSalesforceContact: vi.fn<() => Promise<{ externalId: string }>>(),
  upsertHubspotContact: vi.fn<() => Promise<{ externalId: string }>>(),
  updateSalesforceStatus: vi.fn<() => Promise<{ externalId: string; response: unknown }>>(),
  updateHubspotStatus: vi.fn<() => Promise<{ externalId: string; response: unknown }>>(),
}));

vi.mock("@quiksend/integrations", () => ({
  getNango: () => ({}),
  logSalesforceTask: nangoMocks.logSalesforceTask,
  logHubspotEngagement: nangoMocks.logHubspotEngagement,
  upsertSalesforceContact: nangoMocks.upsertSalesforceContact,
  upsertHubspotContact: nangoMocks.upsertHubspotContact,
  updateSalesforceStatus: nangoMocks.updateSalesforceStatus,
  updateHubspotStatus: nangoMocks.updateHubspotStatus,
}));

let writebackHandler: ((payload: CrmWritebackPayload) => Promise<void>) | null = null;

vi.mock("@quiksend/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/queue")>();
  return {
    ...actual,
    registerHandler: vi.fn<
      (job: string, handler: (payload: CrmWritebackPayload) => Promise<void>) => Promise<void>
    >(async (job, handler) => {
      if (job === "crm.writeback") {
        writebackHandler = handler;
      }
    }),
  };
});

describe("crm.writeback handler", () => {
  beforeEach(async () => {
    writebackHandler = null;
    vi.clearAllMocks();
    await registerCrmWritebackHandler();
    if (!writebackHandler) throw new Error("handler not registered");
  });

  it("skips replay when a succeeded log row already exists for the idempotency key", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [connection] = await db
        .insert(tables.crmConnection)
        .values({
          organizationId: orgA.id,
          provider: "hubspot",
          nangoConnectionId: "nango-writeback-test",
          status: "active",
          fieldMapping: {},
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!connection) throw new Error("setup failed");

      const [prospect] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "writeback@crm.test",
          crmExternalId: "hs-123",
          crmProvider: "hubspot",
          crmConnectionId: connection.id,
        })
        .returning();
      if (!prospect) throw new Error("setup failed");

      const [message] = await db
        .insert(tables.message)
        .values({
          organizationId: orgA.id,
          mailboxId: (
            await db
              .insert(tables.mailbox)
              .values({
                organizationId: orgA.id,
                ownerUserId: orgA.userId,
                provider: "smtp",
                address: "sender@crm.test",
                status: "active",
              })
              .returning()
          )[0]!.id,
          prospectId: prospect.id,
          direction: "outbound",
          subject: "Hello",
          status: "sent",
          sentAt: new Date(),
        })
        .returning();
      if (!message) throw new Error("setup failed");

      const idempotencyKey = "writeback-replay-key";

      await db.insert(tables.crmWritebackLog).values({
        organizationId: orgA.id,
        crmConnectionId: connection.id,
        eventType: "activity_log",
        entityType: "message",
        entityId: message.id,
        idempotencyKey,
        status: "succeeded",
        payload: { eventType: "send" },
      });

      const beforeCount = (
        await db.query.crmWritebackLog.findMany({
          where: eq(tables.crmWritebackLog.idempotencyKey, idempotencyKey),
        })
      ).length;

      await writebackHandler!({
        connectionId: connection.id,
        eventType: "send",
        entityId: message.id,
        idempotencyKey,
      });

      const afterRows = await db.query.crmWritebackLog.findMany({
        where: eq(tables.crmWritebackLog.idempotencyKey, idempotencyKey),
      });

      expect(afterRows).toHaveLength(beforeCount);
      expect(nangoMocks.logHubspotEngagement).not.toHaveBeenCalled();
      expect(nangoMocks.logSalesforceTask).not.toHaveBeenCalled();
      expect(nangoMocks.upsertHubspotContact).not.toHaveBeenCalled();
    });
  });
});
