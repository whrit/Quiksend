import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asOrganizationId, asUserId, type OrgContext } from "@quiksend/core";
import { createApiKeyForOrg } from "../../../lib/api-keys.functions.ts";
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

      const orgContext: OrgContext = {
        userId: asUserId(orgA.userId),
        organizationId: asOrganizationId(orgA.id),
        role: "owner",
      };
      const created = await createApiKeyForOrg(orgContext, { name: "Org A test key" });

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
