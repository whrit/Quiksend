import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";

describe("prospect tenancy", () => {
  it("org B cannot read org A prospects", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [prospectA] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "alice@acme.io",
          firstName: "Alice",
        })
        .returning();
      if (!prospectA) throw new Error("setup failed");

      const fromOrgB = await db.query.prospect.findFirst({
        where: and(
          eq(tables.prospect.id, prospectA.id),
          eq(tables.prospect.organizationId, orgB.id),
          isNull(tables.prospect.deletedAt),
        ),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot update org A prospects", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [prospectA] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "bob@acme.io",
          firstName: "Bob",
        })
        .returning();
      if (!prospectA) throw new Error("setup failed");

      const [updated] = await db
        .update(tables.prospect)
        .set({ firstName: "Hacked" })
        .where(
          and(eq(tables.prospect.id, prospectA.id), eq(tables.prospect.organizationId, orgB.id)),
        )
        .returning();

      expect(updated).toBeUndefined();

      const unchanged = await db.query.prospect.findFirst({
        where: eq(tables.prospect.id, prospectA.id),
      });
      expect(unchanged?.firstName).toBe("Bob");
    });
  });

  it("org B cannot soft-delete org A prospects", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [prospectA] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "carol@acme.io",
        })
        .returning();
      if (!prospectA) throw new Error("setup failed");

      const [deleted] = await db
        .update(tables.prospect)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(tables.prospect.id, prospectA.id), eq(tables.prospect.organizationId, orgB.id)),
        )
        .returning();

      expect(deleted).toBeUndefined();

      const stillActive = await db.query.prospect.findFirst({
        where: eq(tables.prospect.id, prospectA.id),
      });
      expect(stillActive?.deletedAt).toBeNull();
    });
  });

  it("two orgs can own prospects with the same email", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await db.insert(tables.prospect).values({
        organizationId: orgA.id,
        email: "shared@acme.io",
      });
      await db.insert(tables.prospect).values({
        organizationId: orgB.id,
        email: "shared@acme.io",
      });

      const inA = await db.query.prospect.findFirst({
        where: and(
          eq(tables.prospect.organizationId, orgA.id),
          eq(tables.prospect.email, "shared@acme.io"),
        ),
      });
      const inB = await db.query.prospect.findFirst({
        where: and(
          eq(tables.prospect.organizationId, orgB.id),
          eq(tables.prospect.email, "shared@acme.io"),
        ),
      });

      expect(inA?.id).toBeDefined();
      expect(inB?.id).toBeDefined();
      expect(inA?.id).not.toBe(inB?.id);
    });
  });

  it("CRM columns default to null", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [row] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "crm-null@acme.io",
        })
        .returning();
      if (!row) throw new Error("setup failed");

      expect(row.crmProvider).toBeNull();
      expect(row.crmExternalId).toBeNull();
      expect(row.crmConnectionId).toBeNull();
      expect(row.lastCrmSyncAt).toBeNull();
    });
  });
});
