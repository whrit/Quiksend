import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";

describe("mailbox tenancy", () => {
  it("org B cannot read org A mailboxes", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [mailboxA] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "alice@mailbox.test",
          status: "active",
        })
        .returning();
      if (!mailboxA) throw new Error("setup failed");

      const fromOrgB = await db.query.mailbox.findFirst({
        where: and(eq(tables.mailbox.id, mailboxA.id), eq(tables.mailbox.organizationId, orgB.id)),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot update org A mailboxes", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [mailboxA] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "bob@mailbox.test",
          status: "active",
        })
        .returning();
      if (!mailboxA) throw new Error("setup failed");

      const [updated] = await db
        .update(tables.mailbox)
        .set({ displayName: "Hacked" })
        .where(and(eq(tables.mailbox.id, mailboxA.id), eq(tables.mailbox.organizationId, orgB.id)))
        .returning();

      expect(updated).toBeUndefined();

      const unchanged = await db.query.mailbox.findFirst({
        where: eq(tables.mailbox.id, mailboxA.id),
      });
      expect(unchanged?.displayName).toBeNull();
    });
  });

  it("org B cannot delete org A mailboxes", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [mailboxA] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "carol@mailbox.test",
          status: "active",
        })
        .returning();
      if (!mailboxA) throw new Error("setup failed");

      const deleted = await db
        .delete(tables.mailbox)
        .where(and(eq(tables.mailbox.id, mailboxA.id), eq(tables.mailbox.organizationId, orgB.id)))
        .returning();

      expect(deleted).toHaveLength(0);

      const stillThere = await db.query.mailbox.findFirst({
        where: eq(tables.mailbox.id, mailboxA.id),
      });
      expect(stillThere?.id).toBe(mailboxA.id);
    });
  });

  it("two orgs can each have a mailbox with the same address", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await db.insert(tables.mailbox).values({
        organizationId: orgA.id,
        ownerUserId: orgA.userId,
        provider: "smtp",
        address: "shared@mailbox.test",
        status: "active",
      });
      await db.insert(tables.mailbox).values({
        organizationId: orgB.id,
        ownerUserId: orgB.userId,
        provider: "smtp",
        address: "shared@mailbox.test",
        status: "active",
      });

      const inA = await db.query.mailbox.findFirst({
        where: and(
          eq(tables.mailbox.organizationId, orgA.id),
          eq(tables.mailbox.address, "shared@mailbox.test"),
        ),
      });
      const inB = await db.query.mailbox.findFirst({
        where: and(
          eq(tables.mailbox.organizationId, orgB.id),
          eq(tables.mailbox.address, "shared@mailbox.test"),
        ),
      });

      expect(inA?.id).toBeDefined();
      expect(inB?.id).toBeDefined();
      expect(inA?.id).not.toBe(inB?.id);
    });
  });
});
