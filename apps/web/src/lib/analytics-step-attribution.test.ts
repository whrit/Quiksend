import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { truncateAppTables, withTestOrgs } from "@quiksend/db/testing";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Per-step message attribution.
 *
 * The bug this guards: analytics grouped messages by `enrollment.currentStepIndex`,
 * so once an enrollment advanced, every message it had ever sent was re-attributed
 * to its latest step. An enrollment sitting on step 2 reported all three of its
 * sends against step 2 and zero against steps 0 and 1.
 */
describe("per-step message attribution", () => {
  beforeEach(async () => {
    await truncateAppTables();
  });

  it("attributes each message to the step it was sent for, not the enrollment's current step", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "sender@attribution.test",
        })
        .returning();

      const [prospect] = await db
        .insert(tables.prospect)
        .values({ organizationId: orgA.id, email: "target@attribution.test" })
        .returning();

      const [sequence] = await db
        .insert(tables.sequence)
        .values({ organizationId: orgA.id, name: "Attribution", createdByUserId: orgA.userId })
        .returning();

      // Enrollment has advanced to step 2 — the pre-fix code attributed all
      // three messages below to step 2 purely because of this value.
      const [enrollment] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          prospectId: prospect!.id,
          mailboxId: mailbox!.id,
          state: "active",
          currentStepIndex: 2,
          createdByUserId: orgA.userId,
        })
        .returning();

      for (const stepIndex of [0, 1, 2]) {
        await db.insert(tables.message).values({
          organizationId: orgA.id,
          mailboxId: mailbox!.id,
          prospectId: prospect!.id,
          enrollmentId: enrollment!.id,
          sequenceStepIndex: stepIndex,
          direction: "outbound",
          status: "sent",
          subject: `step ${stepIndex}`,
        });
      }

      // A manual compose send is linked to the enrollment but belongs to no
      // step; it must not inflate any step's count.
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox!.id,
        prospectId: prospect!.id,
        enrollmentId: enrollment!.id,
        sequenceStepIndex: null,
        direction: "outbound",
        status: "sent",
        subject: "manual compose",
      });

      const rows = await db
        .select({
          stepIndex: tables.message.sequenceStepIndex,
          count: sql<number>`count(*)::int`,
        })
        .from(tables.message)
        .innerJoin(
          tables.enrollment,
          and(
            eq(tables.message.enrollmentId, tables.enrollment.id),
            eq(tables.enrollment.organizationId, orgA.id),
          ),
        )
        .where(
          and(
            eq(tables.message.organizationId, orgA.id),
            eq(tables.enrollment.sequenceId, sequence!.id),
            eq(tables.message.direction, "outbound"),
            isNotNull(tables.message.sequenceStepIndex),
          ),
        )
        .groupBy(tables.message.sequenceStepIndex);

      const byStep = new Map(rows.map((r) => [r.stepIndex as number, r.count]));

      // One message per step — not three against step 2.
      expect(byStep.get(0)).toBe(1);
      expect(byStep.get(1)).toBe(1);
      expect(byStep.get(2)).toBe(1);
      // The manual send is excluded entirely.
      expect([...byStep.values()].reduce((a, b) => a + b, 0)).toBe(3);
    });
  });
});
