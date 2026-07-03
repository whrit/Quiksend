import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";

async function seedMailbox(orgId: string, userId: string) {
  const [mailbox] = await db
    .insert(tables.mailbox)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      provider: "smtp",
      address: `sender-${orgId}@message.test`,
      status: "active",
    })
    .returning();
  if (!mailbox) throw new Error("setup failed");
  return mailbox;
}

describe("message tenancy", () => {
  it("org B cannot read org A messages", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const mailbox = await seedMailbox(orgA.id, orgA.userId);
      const [messageA] = await db
        .insert(tables.message)
        .values({
          organizationId: orgA.id,
          mailboxId: mailbox.id,
          direction: "outbound",
          subject: "Hello",
          status: "sent",
          sentAt: new Date(),
        })
        .returning();
      if (!messageA) throw new Error("setup failed");

      const fromOrgB = await db.query.message.findFirst({
        where: and(eq(tables.message.id, messageA.id), eq(tables.message.organizationId, orgB.id)),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot update org A messages", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const mailbox = await seedMailbox(orgA.id, orgA.userId);
      const [messageA] = await db
        .insert(tables.message)
        .values({
          organizationId: orgA.id,
          mailboxId: mailbox.id,
          direction: "outbound",
          subject: "Original",
          status: "sent",
          sentAt: new Date(),
        })
        .returning();
      if (!messageA) throw new Error("setup failed");

      const [updated] = await db
        .update(tables.message)
        .set({ subject: "Hacked" })
        .where(and(eq(tables.message.id, messageA.id), eq(tables.message.organizationId, orgB.id)))
        .returning();

      expect(updated).toBeUndefined();

      const unchanged = await db.query.message.findFirst({
        where: eq(tables.message.id, messageA.id),
      });
      expect(unchanged?.subject).toBe("Original");
    });
  });

  it("org B cannot delete org A messages", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const mailbox = await seedMailbox(orgA.id, orgA.userId);
      const [messageA] = await db
        .insert(tables.message)
        .values({
          organizationId: orgA.id,
          mailboxId: mailbox.id,
          direction: "outbound",
          subject: "Protected",
          status: "sent",
          sentAt: new Date(),
        })
        .returning();
      if (!messageA) throw new Error("setup failed");

      const deleted = await db
        .delete(tables.message)
        .where(and(eq(tables.message.id, messageA.id), eq(tables.message.organizationId, orgB.id)))
        .returning();

      expect(deleted).toHaveLength(0);

      const stillThere = await db.query.message.findFirst({
        where: eq(tables.message.id, messageA.id),
      });
      expect(stillThere?.id).toBe(messageA.id);
    });
  });

  it("two orgs can each store messages with the same subject", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const mailboxA = await seedMailbox(orgA.id, orgA.userId);
      const mailboxB = await seedMailbox(orgB.id, orgB.userId);

      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailboxA.id,
        direction: "outbound",
        subject: "Shared subject",
        status: "sent",
        sentAt: new Date(),
      });
      await db.insert(tables.message).values({
        organizationId: orgB.id,
        mailboxId: mailboxB.id,
        direction: "outbound",
        subject: "Shared subject",
        status: "sent",
        sentAt: new Date(),
      });

      const inA = await db.query.message.findFirst({
        where: and(
          eq(tables.message.organizationId, orgA.id),
          eq(tables.message.subject, "Shared subject"),
        ),
      });
      const inB = await db.query.message.findFirst({
        where: and(
          eq(tables.message.organizationId, orgB.id),
          eq(tables.message.subject, "Shared subject"),
        ),
      });

      expect(inA?.id).toBeDefined();
      expect(inB?.id).toBeDefined();
      expect(inA?.id).not.toBe(inB?.id);
    });
  });
});
