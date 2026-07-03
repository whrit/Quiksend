import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";

describe("crm connection tenancy", () => {
  it("org B cannot read org A CRM connections", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [connectionA] = await db
        .insert(tables.crmConnection)
        .values({
          organizationId: orgA.id,
          provider: "hubspot",
          nangoConnectionId: "nango-org-a",
          status: "active",
          fieldMapping: {},
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!connectionA) throw new Error("setup failed");

      const fromOrgB = await db.query.crmConnection.findFirst({
        where: and(
          eq(tables.crmConnection.id, connectionA.id),
          eq(tables.crmConnection.organizationId, orgB.id),
        ),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot update org A CRM connections", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [connectionA] = await db
        .insert(tables.crmConnection)
        .values({
          organizationId: orgA.id,
          provider: "salesforce",
          nangoConnectionId: "nango-sf-a",
          status: "active",
          fieldMapping: {},
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!connectionA) throw new Error("setup failed");

      const [updated] = await db
        .update(tables.crmConnection)
        .set({ status: "inactive" })
        .where(
          and(
            eq(tables.crmConnection.id, connectionA.id),
            eq(tables.crmConnection.organizationId, orgB.id),
          ),
        )
        .returning();

      expect(updated).toBeUndefined();

      const unchanged = await db.query.crmConnection.findFirst({
        where: eq(tables.crmConnection.id, connectionA.id),
      });
      expect(unchanged?.status).toBe("active");
    });
  });

  it("org B cannot delete org A CRM connections", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [connectionA] = await db
        .insert(tables.crmConnection)
        .values({
          organizationId: orgA.id,
          provider: "hubspot",
          nangoConnectionId: "nango-delete-a",
          status: "active",
          fieldMapping: {},
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!connectionA) throw new Error("setup failed");

      const deleted = await db
        .delete(tables.crmConnection)
        .where(
          and(
            eq(tables.crmConnection.id, connectionA.id),
            eq(tables.crmConnection.organizationId, orgB.id),
          ),
        )
        .returning();

      expect(deleted).toHaveLength(0);

      const stillThere = await db.query.crmConnection.findFirst({
        where: eq(tables.crmConnection.id, connectionA.id),
      });
      expect(stillThere?.id).toBe(connectionA.id);
    });
  });

  it("two orgs can each connect the same CRM provider", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await db.insert(tables.crmConnection).values({
        organizationId: orgA.id,
        provider: "hubspot",
        nangoConnectionId: "nango-shared-a",
        status: "active",
        fieldMapping: {},
        createdByUserId: orgA.userId,
      });
      await db.insert(tables.crmConnection).values({
        organizationId: orgB.id,
        provider: "hubspot",
        nangoConnectionId: "nango-shared-b",
        status: "active",
        fieldMapping: {},
        createdByUserId: orgB.userId,
      });

      const inA = await db.query.crmConnection.findFirst({
        where: and(
          eq(tables.crmConnection.organizationId, orgA.id),
          eq(tables.crmConnection.provider, "hubspot"),
        ),
      });
      const inB = await db.query.crmConnection.findFirst({
        where: and(
          eq(tables.crmConnection.organizationId, orgB.id),
          eq(tables.crmConnection.provider, "hubspot"),
        ),
      });

      expect(inA?.id).toBeDefined();
      expect(inB?.id).toBeDefined();
      expect(inA?.id).not.toBe(inB?.id);
    });
  });
});
