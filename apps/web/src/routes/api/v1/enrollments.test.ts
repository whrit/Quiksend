import { and, eq, isNull } from "drizzle-orm";
import { asOrganizationId, asUserId, type OrgContext } from "@quiksend/core";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { describe, expect, it } from "vitest";
import { createApiKeyForOrg } from "../../../lib/api-keys.functions.ts";
import { resolveApiKey } from "../../../lib/api/v1/middleware.ts";

async function createOrgApiKey(org: { id: string; userId: string }): Promise<string> {
  const orgContext: OrgContext = {
    userId: asUserId(org.userId),
    organizationId: asOrganizationId(org.id),
    role: "owner",
  };
  const created = await createApiKeyForOrg(orgContext, { name: "Org test key" });
  return created.key;
}

describe("POST /api/v1/enrollments API key scoping", () => {
  it("blocks org A key from enrolling into org B sequence", async () => {
    await withTestOrgs(async ({ orgA, orgB }) => {
      const [mailboxB] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgB.id,
          ownerUserId: orgB.userId,
          provider: "smtp",
          address: "mb-b@enrollments.test",
          status: "active",
        })
        .returning();
      if (!mailboxB) throw new Error("setup failed");

      const [prospectB] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgB.id,
          email: "prospect-b@enrollments.test",
        })
        .returning();
      if (!prospectB) throw new Error("setup failed");

      const [sequenceB] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgB.id,
          name: "Org B Sequence",
          status: "active",
          settings: { mailbox_ids: [mailboxB.id] },
          createdByUserId: orgB.userId,
        })
        .returning();
      if (!sequenceB) throw new Error("setup failed");

      const apiKey = await createOrgApiKey(orgA);
      const request = new Request("http://localhost/api/v1/enrollments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sequenceId: sequenceB.id,
          prospectIds: [prospectB.id],
        }),
      });

      const ctx = await resolveApiKey(request);
      expect(ctx).not.toBeNull();
      expect(ctx!.orgId).toBe(orgA.id);

      const seq = await db.query.sequence.findFirst({
        where: and(
          eq(tables.sequence.id, sequenceB.id),
          eq(tables.sequence.organizationId, ctx!.orgId),
          isNull(tables.sequence.deletedAt),
        ),
      });

      expect(seq).toBeUndefined();
    });
  });

  it("allows org A key to enroll into its own sequence", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailboxA] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "mb-a@enrollments.test",
          status: "active",
        })
        .returning();
      if (!mailboxA) throw new Error("setup failed");

      const [prospectA] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "prospect-a@enrollments.test",
        })
        .returning();
      if (!prospectA) throw new Error("setup failed");

      const [sequenceA] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Org A Sequence",
          status: "active",
          settings: { mailbox_ids: [mailboxA.id] },
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!sequenceA) throw new Error("setup failed");

      await db.insert(tables.sequenceStep).values({
        organizationId: orgA.id,
        sequenceId: sequenceA.id,
        stepIndex: 0,
        stepType: "wait",
        delayMinutes: 60,
        config: { minutes: 60 },
      });

      const apiKey = await createOrgApiKey(orgA);
      const request = new Request("http://localhost/api/v1/enrollments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sequenceId: sequenceA.id,
          prospectIds: [prospectA.id],
        }),
      });

      const ctx = await resolveApiKey(request);
      expect(ctx).not.toBeNull();
      expect(ctx!.userId).toBeNull();

      const seq = await db.query.sequence.findFirst({
        where: and(
          eq(tables.sequence.id, sequenceA.id),
          eq(tables.sequence.organizationId, ctx!.orgId),
          isNull(tables.sequence.deletedAt),
        ),
      });

      expect(seq).toBeDefined();
      expect(seq!.status).toBe("active");

      // Mirrors the exact write `apps/web/src/routes/api/v1/enrollments.ts`
      // makes on a successful enrollment — `ctx.userId` is truthfully `null`
      // (org-owned keys have no human creator), never a synthetic owner.
      const [enrolled] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: ctx!.orgId,
          sequenceId: sequenceA.id,
          prospectId: prospectA.id,
          mailboxId: mailboxA.id,
          state: "active",
          currentStepIndex: 0,
          createdByUserId: ctx!.userId,
        })
        .returning();
      expect(enrolled?.createdByUserId).toBeNull();
    });
  });
});
