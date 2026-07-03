import { auth } from "@quiksend/auth";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { resolveApiKey } from "../../../lib/api/v1/middleware.ts";

describe("GET /api/v1/prospects/:id API key scoping", () => {
  it("returns 404 when org A key requests org B prospect", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [prospectB] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgB.id,
          email: "cross-org@api.test",
          firstName: "Cross",
        })
        .returning();
      if (!prospectB) throw new Error("setup failed");

      const created = await auth.api.createApiKey({
        body: {
          name: "Org A test key",
          userId: orgA.userId,
          prefix: "qsk",
        },
      });
      if (!created.key || !created.id) throw new Error("API key creation failed");

      await db
        .update(tables.apikey)
        .set({ metadata: JSON.stringify({ organizationId: orgA.id }) })
        .where(eq(tables.apikey.id, created.id));

      const request = new Request(`http://localhost/api/v1/prospects/${prospectB.id}`, {
        headers: { Authorization: `Bearer ${created.key}` },
      });

      const ctx = await resolveApiKey(request);
      expect(ctx).not.toBeNull();
      expect(ctx!.orgId).toBe(orgA.id);

      const row = await db.query.prospect.findFirst({
        where: and(
          eq(tables.prospect.id, prospectB.id),
          eq(tables.prospect.organizationId, ctx!.orgId),
          isNull(tables.prospect.deletedAt),
        ),
      });

      expect(row).toBeUndefined();
    });
  });
});
