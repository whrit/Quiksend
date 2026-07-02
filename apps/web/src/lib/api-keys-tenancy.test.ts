import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";

function orgScopedKeyFilter(orgId: string) {
  return sql`${tables.apikey.metadata}::jsonb->>'organizationId' = ${orgId}`;
}

async function insertOrgApiKey(input: {
  userId: string;
  organizationId: string;
  name: string;
}): Promise<string> {
  const id = `key_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date();
  await db.insert(tables.apikey).values({
    id,
    name: input.name,
    referenceId: input.userId,
    key: `hashed_${randomUUID()}`,
    metadata: JSON.stringify({ organizationId: input.organizationId }),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("api key tenancy", () => {
  it("org B cannot read org A API keys when scoped by workspace metadata", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const keyId = await insertOrgApiKey({
        userId: orgA.userId,
        organizationId: orgA.id,
        name: "Org A key",
      });

      const fromOrgB = await db.query.apikey.findFirst({
        where: and(eq(tables.apikey.id, keyId), orgScopedKeyFilter(orgB.id)),
      });

      expect(fromOrgB).toBeUndefined();
    });
  });

  it("org B cannot update org A API keys via workspace metadata scope", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const keyId = await insertOrgApiKey({
        userId: orgA.userId,
        organizationId: orgA.id,
        name: "Protected key",
      });

      const [updated] = await db
        .update(tables.apikey)
        .set({ name: "Hacked" })
        .where(and(eq(tables.apikey.id, keyId), orgScopedKeyFilter(orgB.id)))
        .returning();

      expect(updated).toBeUndefined();

      const unchanged = await db.query.apikey.findFirst({
        where: eq(tables.apikey.id, keyId),
      });
      expect(unchanged?.name).toBe("Protected key");
    });
  });

  it("org B cannot delete org A API keys via workspace metadata scope", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const keyId = await insertOrgApiKey({
        userId: orgA.userId,
        organizationId: orgA.id,
        name: "Delete target",
      });

      const deleted = await db
        .delete(tables.apikey)
        .where(and(eq(tables.apikey.id, keyId), orgScopedKeyFilter(orgB.id)))
        .returning();

      expect(deleted).toHaveLength(0);

      const stillThere = await db.query.apikey.findFirst({
        where: eq(tables.apikey.id, keyId),
      });
      expect(stillThere?.id).toBe(keyId);
    });
  });

  it("two orgs can each create API keys with the same display name", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const keyA = await insertOrgApiKey({
        userId: orgA.userId,
        organizationId: orgA.id,
        name: "Integration key",
      });
      const keyB = await insertOrgApiKey({
        userId: orgB.userId,
        organizationId: orgB.id,
        name: "Integration key",
      });

      expect(keyA).toBeDefined();
      expect(keyB).toBeDefined();
      expect(keyA).not.toBe(keyB);
    });
  });
});
