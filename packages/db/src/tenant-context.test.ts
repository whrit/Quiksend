import { beforeEach, describe, expect, it } from "vitest";
import { client, db } from "./client.ts";
import { company } from "./schema/prospects.ts";
import { truncateAppTables, withTestOrgs } from "./testing.ts";
import { withTenantTransaction } from "./tenant-context.ts";

describe("withTenantTransaction", () => {
  beforeEach(async () => {
    await truncateAppTables();
  });

  it("org-A app role cannot read org-B data", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      // Seed as owner (bypasses RLS — ENABLE without FORCE)
      await db.insert(company).values({
        organizationId: orgA.id,
        name: "Org A Corp",
      });
      await db.insert(company).values({
        organizationId: orgB.id,
        name: "Org B Corp",
      });

      const orgARows = await withTenantTransaction(orgA.id, (tx) => tx.select().from(company));
      expect(orgARows).toHaveLength(1);
      expect(orgARows[0]!.name).toBe("Org A Corp");

      const orgBRows = await withTenantTransaction(orgB.id, (tx) => tx.select().from(company));
      expect(orgBRows).toHaveLength(1);
      expect(orgBRows[0]!.name).toBe("Org B Corp");
    });
  });

  it("org-A app role cannot write to org-B", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      await expect(
        withTenantTransaction(orgA.id, (tx) =>
          tx.insert(company).values({
            organizationId: orgB.id,
            name: "Cross-tenant write",
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("missing tenant setting yields no tenant rows", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(company).values({
        organizationId: orgA.id,
        name: "Test Corp",
      });

      // Switch to quiksend_app role without setting organization_id
      const rows = await client.begin(async (sql) => {
        await sql`SET LOCAL ROLE quiksend_app`;
        return sql`SELECT * FROM company`;
      });
      expect(rows).toHaveLength(0);
    });
  });

  it("local setting does not leak after transaction", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(company).values({
        organizationId: orgA.id,
        name: "Test Corp",
      });

      // Run a scoped tenant transaction
      const rows = await withTenantTransaction(orgA.id, (tx) => tx.select().from(company));
      expect(rows).toHaveLength(1);

      // After the transaction, the config reverts — should be null or empty
      const result = await client`SELECT current_setting('app.organization_id', true) AS val`;
      const val = result[0]?.["val"] as string | null;
      expect(val ?? "").toBe("");

      // A fresh quiksend_app session sees nothing
      const postRows = await client.begin(async (sql) => {
        await sql`SET LOCAL ROLE quiksend_app`;
        return sql`SELECT * FROM company`;
      });
      expect(postRows).toHaveLength(0);
    });
  });
});
