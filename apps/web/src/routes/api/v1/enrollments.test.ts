import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@quiksend/auth";
import { db, tables } from "@quiksend/db";
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

      const apiKey = await createOrgApiKey(orgA.id, orgA.userId);
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

      const apiKey = await createOrgApiKey(orgA.id, orgA.userId);
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

      const seq = await db.query.sequence.findFirst({
        where: and(
          eq(tables.sequence.id, sequenceA.id),
          eq(tables.sequence.organizationId, ctx!.orgId),
          isNull(tables.sequence.deletedAt),
        ),
      });

      expect(seq).toBeDefined();
      expect(seq!.status).toBe("active");
    });
  });
});
