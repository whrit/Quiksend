import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";

describe("webhook tenancy", () => {
  it("org B cannot read org A webhook endpoints", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [endpointA] = await db
        .insert(tables.webhookEndpoint)
        .values({
          organizationId: orgA.id,
          url: "https://hooks-a.example.com/events",
          secret: "secret-a",
          events: ["message.sent"],
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!endpointA) throw new Error("setup failed");

      const fromOrgB = await db.query.webhookEndpoint.findFirst({
        where: and(
          eq(tables.webhookEndpoint.id, endpointA.id),
          eq(tables.webhookEndpoint.organizationId, orgB.id),
        ),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot update org A webhook endpoints", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [endpointA] = await db
        .insert(tables.webhookEndpoint)
        .values({
          organizationId: orgA.id,
          url: "https://hooks-update.example.com",
          secret: "secret-update",
          events: ["message.sent"],
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!endpointA) throw new Error("setup failed");

      const [updated] = await db
        .update(tables.webhookEndpoint)
        .set({ url: "https://evil.example.com" })
        .where(
          and(
            eq(tables.webhookEndpoint.id, endpointA.id),
            eq(tables.webhookEndpoint.organizationId, orgB.id),
          ),
        )
        .returning();

      expect(updated).toBeUndefined();

      const unchanged = await db.query.webhookEndpoint.findFirst({
        where: eq(tables.webhookEndpoint.id, endpointA.id),
      });
      expect(unchanged?.url).toBe("https://hooks-update.example.com");
    });
  });

  it("org B cannot delete org A webhook endpoints", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [endpointA] = await db
        .insert(tables.webhookEndpoint)
        .values({
          organizationId: orgA.id,
          url: "https://hooks-delete.example.com",
          secret: "secret-delete",
          events: ["message.sent"],
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!endpointA) throw new Error("setup failed");

      const deleted = await db
        .delete(tables.webhookEndpoint)
        .where(
          and(
            eq(tables.webhookEndpoint.id, endpointA.id),
            eq(tables.webhookEndpoint.organizationId, orgB.id),
          ),
        )
        .returning();

      expect(deleted).toHaveLength(0);

      const stillThere = await db.query.webhookEndpoint.findFirst({
        where: eq(tables.webhookEndpoint.id, endpointA.id),
      });
      expect(stillThere?.id).toBe(endpointA.id);
    });
  });

  it("org B cannot read org A webhook deliveries", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [endpointA] = await db
        .insert(tables.webhookEndpoint)
        .values({
          organizationId: orgA.id,
          url: "https://hooks-delivery.example.com",
          secret: "secret-delivery",
          events: ["message.sent"],
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!endpointA) throw new Error("setup failed");

      const [deliveryA] = await db
        .insert(tables.webhookDelivery)
        .values({
          organizationId: orgA.id,
          endpointId: endpointA.id,
          eventType: "message.sent",
          payload: { id: "msg-1" },
          status: "pending",
        })
        .returning();
      if (!deliveryA) throw new Error("setup failed");

      const fromOrgB = await db.query.webhookDelivery.findFirst({
        where: and(
          eq(tables.webhookDelivery.id, deliveryA.id),
          eq(tables.webhookDelivery.organizationId, orgB.id),
        ),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("two orgs can register webhook endpoints with the same URL", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const url = "https://shared-hooks.example.com/events";
      await db.insert(tables.webhookEndpoint).values({
        organizationId: orgA.id,
        url,
        secret: "secret-a",
        events: ["message.sent"],
        createdByUserId: orgA.userId,
      });
      await db.insert(tables.webhookEndpoint).values({
        organizationId: orgB.id,
        url,
        secret: "secret-b",
        events: ["message.sent"],
        createdByUserId: orgB.userId,
      });

      const inA = await db.query.webhookEndpoint.findFirst({
        where: and(
          eq(tables.webhookEndpoint.organizationId, orgA.id),
          eq(tables.webhookEndpoint.url, url),
        ),
      });
      const inB = await db.query.webhookEndpoint.findFirst({
        where: and(
          eq(tables.webhookEndpoint.organizationId, orgB.id),
          eq(tables.webhookEndpoint.url, url),
        ),
      });

      expect(inA?.id).toBeDefined();
      expect(inB?.id).toBeDefined();
      expect(inA?.id).not.toBe(inB?.id);
    });
  });
});
