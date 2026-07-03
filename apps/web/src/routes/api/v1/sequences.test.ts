import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@quiksend/auth";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { describe, expect, it } from "vitest";
import { resolveApiKey } from "../../../lib/api/v1/middleware.ts";

async function createOrgApiKey(orgId: string, userId: string): Promise<string> {
  const created = await auth.api.createApiKey({
    body: {
      name: "Org test key",
      userId,
      prefix: "qsk",
    },
  });
  if (!created.key || !created.id) throw new Error("API key creation failed");

  await db
    .update(tables.apikey)
    .set({ metadata: JSON.stringify({ organizationId: orgId }) })
    .where(eq(tables.apikey.id, created.id));

  return created.key;
}

describe("GET /api/v1/sequences/:id/analytics API key scoping", () => {
  it("returns 404 when org A key requests org B sequence analytics", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [sequenceB] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgB.id,
          name: "Org B Sequence",
          status: "active",
          createdByUserId: orgB.userId,
        })
        .returning();
      if (!sequenceB) throw new Error("setup failed");

      const apiKey = await createOrgApiKey(orgA.id, orgA.userId);
      const request = new Request(`http://localhost/api/v1/sequences/${sequenceB.id}/analytics`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      const ctx = await resolveApiKey(request);
      expect(ctx).not.toBeNull();
      expect(ctx!.orgId).toBe(orgA.id);

      const row = await db.query.sequence.findFirst({
        where: and(
          eq(tables.sequence.id, sequenceB.id),
          eq(tables.sequence.organizationId, ctx!.orgId),
          isNull(tables.sequence.deletedAt),
        ),
      });

      expect(row).toBeUndefined();
    });
  });

  it("allows org A key to read its own sequence analytics", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [sequenceA] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Org A Sequence",
          status: "active",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!sequenceA) throw new Error("setup failed");

      const apiKey = await createOrgApiKey(orgA.id, orgA.userId);
      const request = new Request(`http://localhost/api/v1/sequences/${sequenceA.id}/analytics`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      const ctx = await resolveApiKey(request);
      expect(ctx).not.toBeNull();

      const row = await db.query.sequence.findFirst({
        where: and(
          eq(tables.sequence.id, sequenceA.id),
          eq(tables.sequence.organizationId, ctx!.orgId),
          isNull(tables.sequence.deletedAt),
        ),
      });

      expect(row).toBeDefined();
      expect(row!.id).toBe(sequenceA.id);
    });
  });
});
