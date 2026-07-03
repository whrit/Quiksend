import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";

describe("sequence tenancy", () => {
  it("org B cannot read org A sequences", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [sequenceA] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Org A Sequence",
          status: "draft",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!sequenceA) throw new Error("setup failed");

      const fromOrgB = await db.query.sequence.findFirst({
        where: and(
          eq(tables.sequence.id, sequenceA.id),
          eq(tables.sequence.organizationId, orgB.id),
          isNull(tables.sequence.deletedAt),
        ),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot update org A sequences", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [sequenceA] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Protected Sequence",
          status: "draft",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!sequenceA) throw new Error("setup failed");

      const [updated] = await db
        .update(tables.sequence)
        .set({ name: "Hacked" })
        .where(
          and(eq(tables.sequence.id, sequenceA.id), eq(tables.sequence.organizationId, orgB.id)),
        )
        .returning();

      expect(updated).toBeUndefined();

      const unchanged = await db.query.sequence.findFirst({
        where: eq(tables.sequence.id, sequenceA.id),
      });
      expect(unchanged?.name).toBe("Protected Sequence");
    });
  });

  it("org B cannot soft-delete org A sequences", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [sequenceA] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Delete Target",
          status: "draft",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!sequenceA) throw new Error("setup failed");

      const [deleted] = await db
        .update(tables.sequence)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(tables.sequence.id, sequenceA.id), eq(tables.sequence.organizationId, orgB.id)),
        )
        .returning();

      expect(deleted).toBeUndefined();

      const stillActive = await db.query.sequence.findFirst({
        where: eq(tables.sequence.id, sequenceA.id),
      });
      expect(stillActive?.deletedAt).toBeNull();
    });
  });

  it("two orgs can each have a sequence with the same name", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await db.insert(tables.sequence).values({
        organizationId: orgA.id,
        name: "Outbound",
        status: "draft",
        createdByUserId: orgA.userId,
      });
      await db.insert(tables.sequence).values({
        organizationId: orgB.id,
        name: "Outbound",
        status: "draft",
        createdByUserId: orgB.userId,
      });

      const inA = await db.query.sequence.findFirst({
        where: and(
          eq(tables.sequence.organizationId, orgA.id),
          eq(tables.sequence.name, "Outbound"),
        ),
      });
      const inB = await db.query.sequence.findFirst({
        where: and(
          eq(tables.sequence.organizationId, orgB.id),
          eq(tables.sequence.name, "Outbound"),
        ),
      });

      expect(inA?.id).toBeDefined();
      expect(inB?.id).toBeDefined();
      expect(inA?.id).not.toBe(inB?.id);
    });
  });
});
