import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { client, db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";

async function cleanupGatewayTables(): Promise<void> {
  await client.unsafe("truncate table gateway_classification restart identity cascade");
}

describe("gateway tenancy", () => {
  it("gateway classification cache is shared across orgs at the same domain", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const domain = "shared-gateway.tenancy.test";
      await db.insert(tables.gatewayClassification).values({
        emailDomain: domain,
        gateway: "proofpoint",
        mxRecords: ["mx.proofpoint.example"],
        evidence: [{ kind: "mx", detail: "test mx match" }],
        confidence: "high",
        ttlUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      try {
        const cacheRow = await db.query.gatewayClassification.findFirst({
          where: eq(tables.gatewayClassification.emailDomain, domain),
        });
        expect(cacheRow?.gateway).toBe("proofpoint");

        await db.insert(tables.prospect).values({
          organizationId: orgA.id,
          email: `alice@${domain}`,
          emailGateway: "proofpoint",
        });
        await db.insert(tables.prospect).values({
          organizationId: orgB.id,
          email: `bob@${domain}`,
          emailGateway: "proofpoint",
        });

        const orgAProspect = await db.query.prospect.findFirst({
          where: and(
            eq(tables.prospect.organizationId, orgA.id),
            eq(tables.prospect.email, `alice@${domain}`),
          ),
        });
        const orgBProspect = await db.query.prospect.findFirst({
          where: and(
            eq(tables.prospect.organizationId, orgB.id),
            eq(tables.prospect.email, `bob@${domain}`),
          ),
        });
        expect(orgAProspect?.emailGateway).toBe("proofpoint");
        expect(orgBProspect?.emailGateway).toBe("proofpoint");
      } finally {
        await cleanupGatewayTables();
      }
    });
  });

  it("org B cannot read org A prospect gateway fields", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const domain = "isolated-gateway.tenancy.test";
      const [prospectA] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: `seg@${domain}`,
          emailGateway: "mimecast",
        })
        .returning();
      if (!prospectA) throw new Error("setup failed");

      const fromOrgB = await db.query.prospect.findFirst({
        where: and(
          eq(tables.prospect.id, prospectA.id),
          eq(tables.prospect.organizationId, orgB.id),
        ),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot update org A prospect gateway classification", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [prospectA] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "gateway-update@tenancy.test",
          emailGateway: "proofpoint",
        })
        .returning();
      if (!prospectA) throw new Error("setup failed");

      const [updated] = await db
        .update(tables.prospect)
        .set({ emailGateway: "unknown" })
        .where(
          and(eq(tables.prospect.id, prospectA.id), eq(tables.prospect.organizationId, orgB.id)),
        )
        .returning();

      expect(updated).toBeUndefined();

      const unchanged = await db.query.prospect.findFirst({
        where: eq(tables.prospect.id, prospectA.id),
      });
      expect(unchanged?.emailGateway).toBe("proofpoint");
    });
  });
});
