import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { truncateAppTables, withTestOrgs } from "@quiksend/db/testing";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { sendAndRecord } from "./durable-send.ts";

/**
 * The contract: an outbound message is always recorded, whatever the network does.
 *
 * The bug this guards: compose and inbox reply used to call adapter.send() and
 * only then insert the row. A failed insert left a delivered email with nothing
 * behind it — no audit trail, no thread anchor, nothing to prevent a resend.
 */
async function seedMailboxAndProspect(orgId: string, userId: string) {
  const [mailbox] = await db
    .insert(tables.mailbox)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      provider: "smtp",
      address: "sender@durable.test",
    })
    .returning();
  const [prospect] = await db
    .insert(tables.prospect)
    .values({ organizationId: orgId, email: "target@durable.test" })
    .returning();
  return { mailboxId: mailbox!.id, prospectId: prospect!.id };
}

describe("sendAndRecord", () => {
  beforeEach(async () => {
    await truncateAppTables();
  });

  it("records the message as sent and stores provider metadata", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { mailboxId, prospectId } = await seedMailboxAndProspect(orgA.id, orgA.userId);
      const sentAt = new Date("2026-02-01T10:00:00Z");

      const { messageId } = await sendAndRecord(
        orgA.id,
        {
          organizationId: orgA.id,
          mailboxId,
          prospectId,
          direction: "outbound",
          subject: "Hello",
          bodyHtml: "<p>hi</p>",
          bodyText: "hi",
        },
        async () => ({
          messageId: "<abc@provider.test>",
          providerMessageId: "provider-1",
          providerThreadId: "thread-1",
          sentAt,
          metadataReconciled: true,
        }),
      );

      const row = await db.query.message.findFirst({
        where: and(
          eq(tables.message.organizationId, orgA.id),
          eq(tables.message.mailboxId, mailboxId),
        ),
      });

      expect(row?.status).toBe("sent");
      expect(row?.messageIdHeader).toBe(messageId);
      expect(row?.providerMessageId).toBe("provider-1");
      expect(row?.providerThreadId).toBe("thread-1");
      expect(row?.sentAt?.toISOString()).toBe(sentAt.toISOString());
      expect(row?.acceptedAt).toBeTruthy();
      expect(row?.metadataReconciledAt).toBeTruthy();
      expect(row?.reconciliationError).toBeNull();
    });
  });

  it("still records the message, marked failed, when the send throws", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { mailboxId, prospectId } = await seedMailboxAndProspect(orgA.id, orgA.userId);

      await expect(
        sendAndRecord(
          orgA.id,
          {
            organizationId: orgA.id,
            mailboxId,
            prospectId,
            direction: "outbound",
            subject: "Doomed",
            bodyHtml: "<p>nope</p>",
            bodyText: "nope",
          },
          async () => {
            throw new Error("smtp refused connection");
          },
        ),
      ).rejects.toThrow(/smtp refused/i);

      // The row must exist — this is the whole point. A send that blew up is
      // still visible, with the reason attached.
      const row = await db.query.message.findFirst({
        where: and(
          eq(tables.message.organizationId, orgA.id),
          eq(tables.message.mailboxId, mailboxId),
        ),
      });

      expect(row).toBeDefined();
      expect(row?.status).toBe("failed");
      expect(row?.error).toMatch(/smtp refused/i);
      expect(row?.sentAt).toBeNull();
    });
  });

  it("keeps the caller's thread id when the provider does not return one", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { mailboxId, prospectId } = await seedMailboxAndProspect(orgA.id, orgA.userId);

      await sendAndRecord(
        orgA.id,
        {
          organizationId: orgA.id,
          mailboxId,
          prospectId,
          direction: "outbound",
          subject: "Re: thread",
          bodyHtml: "<p>reply</p>",
          bodyText: "reply",
          providerThreadId: "caller-thread",
        },
        async () => ({
          messageId: "<def@provider.test>",
          providerMessageId: "provider-2",
          providerThreadId: null,
          sentAt: new Date("2026-02-01T11:00:00Z"),
          metadataReconciled: true,
        }),
      );

      const row = await db.query.message.findFirst({
        where: and(
          eq(tables.message.organizationId, orgA.id),
          eq(tables.message.mailboxId, mailboxId),
        ),
      });

      expect(row?.providerThreadId).toBe("caller-thread");
    });
  });

  it("persists accepted-but-unreconciled result as sent with nullable metadata", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { mailboxId, prospectId } = await seedMailboxAndProspect(orgA.id, orgA.userId);
      const sentAt = new Date("2026-02-01T12:00:00Z");

      const { messageId, result } = await sendAndRecord(
        orgA.id,
        {
          organizationId: orgA.id,
          mailboxId,
          prospectId,
          direction: "outbound",
          subject: "Unreconciled",
          bodyHtml: "<p>accepted</p>",
          bodyText: "accepted",
        },
        async () => ({
          messageId: "<unreconciled@provider.test>",
          providerMessageId: null,
          providerThreadId: null,
          sentAt,
          metadataReconciled: false,
        }),
      );

      expect(result.metadataReconciled).toBe(false);

      const row = await db.query.message.findFirst({
        where: and(
          eq(tables.message.organizationId, orgA.id),
          eq(tables.message.mailboxId, mailboxId),
        ),
      });

      // Accepted mail is NEVER marked failed
      expect(row?.status).toBe("sent");
      expect(row?.messageIdHeader).toBe(messageId);
      expect(row?.providerMessageId).toBeNull();
      expect(row?.providerThreadId).toBeNull();
      expect(row?.sentAt?.toISOString()).toBe(sentAt.toISOString());
      expect(row?.acceptedAt).toBeTruthy();
      // Reconciliation not done
      expect(row?.metadataReconciledAt).toBeNull();
      expect(row?.reconciliationError).toBe("metadata lookup failed post-acceptance");
    });
  });
});
