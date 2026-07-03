import { describe, expect, it } from "vitest";
import { withTestOrgs } from "@quiksend/db/testing";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { eq } from "drizzle-orm";
import { loadPauseContext } from "./auto-pause-batch-loader.ts";

describe("loadPauseContext", () => {
  it("batch-loads sequence and org threshold for multiple groups", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const member = await db.query.member.findFirst({
        where: eq(tables.member.organizationId, orgA.id),
      });
      if (!member) throw new Error("member missing");

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "pause-batch-test",
          status: "active",
          canaryConfig: { pauseThresholdPct: 55 },
          createdByUserId: member.userId,
        })
        .returning();

      await db
        .update(tables.organization)
        .set({
          metadata: JSON.stringify({
            canary_defaults: { pauseThresholdPct: 80 },
          }),
        })
        .where(eq(tables.organization.id, orgA.id));

      const mailbox = await db.query.mailbox.findFirst({
        where: eq(tables.mailbox.organizationId, orgA.id),
      });

      const groups = [
        {
          sequenceId: sequence!.id,
          mailboxId: mailbox?.id ?? "00000000-0000-4000-8000-000000000001",
          gateway: "proofpoint" as const,
          organizationId: orgA.id,
        },
      ];

      const ctx = await loadPauseContext(groups);
      const key = `${orgA.id}:${sequence!.id}:${groups[0]!.mailboxId}:proofpoint`;
      const loaded = ctx.get(key);

      expect(loaded).toBeDefined();
      expect(loaded?.sequenceName).toBe("pause-batch-test");
      expect(loaded?.threshold).toBe(55);
    });
  });
});
