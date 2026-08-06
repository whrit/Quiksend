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

  it("attributes messages to the selected A/B variant based on enrollment.abBucket", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "sender@ab-test",
        })
        .returning();

      const [prospect] = await db
        .insert(tables.prospect)
        .values({ organizationId: orgA.id, email: "target@ab-test" })
        .returning();
      const [prospectB] = await db
        .insert(tables.prospect)
        .values({ organizationId: orgA.id, email: "target-b@ab-test" })
        .returning();

      const [sequence] = await db
        .insert(tables.sequence)
        .values({ organizationId: orgA.id, name: "AB Test Sequence", createdByUserId: orgA.userId })
        .returning();

      // Step with both config (control) and variantB (variant)
      const [_step] = await db
        .insert(tables.sequenceStep)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          stepIndex: 0,
          stepType: "auto_email",
          config: {
            subject: "Control Subject",
            body_template: "Control Body",
            ai_generate: false,
          },
          variantB: {
            subject: "Variant B Subject",
            body_template: "Variant B Body",
            ai_generate: false,
          },
        })
        .returning();

      // Enrollment with abBucket: "A" — should use config
      const [enrollmentA] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          prospectId: prospect!.id,
          mailboxId: mailbox!.id,
          state: "active",
          abBucket: "A",
          currentStepIndex: 0,
          createdByUserId: orgA.userId,
        })
        .returning();

      // Enrollment with abBucket: "B" — should use variantB
      const [enrollmentB] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          prospectId: prospectB!.id,
          mailboxId: mailbox!.id,
          state: "active",
          abBucket: "B",
          currentStepIndex: 0,
          createdByUserId: orgA.userId,
        })
        .returning();

      // Message for bucket A uses control config
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox!.id,
        prospectId: prospect!.id,
        enrollmentId: enrollmentA!.id,
        sequenceStepIndex: 0,
        direction: "outbound",
        status: "sent",
        subject: "Control Subject",
      });

      // Message for bucket B uses variantB config
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox!.id,
        prospectId: prospectB!.id,
        enrollmentId: enrollmentB!.id,
        sequenceStepIndex: 0,
        direction: "outbound",
        status: "sent",
        subject: "Variant B Subject",
      });

      const messages = await db
        .select()
        .from(tables.message)
        .where(
          and(eq(tables.message.organizationId, orgA.id), eq(tables.message.direction, "outbound")),
        )
        .orderBy(tables.message.subject);

      expect(messages).toHaveLength(2);
      const msg0 = messages[0];
      if (!msg0) throw new Error("Expected messages[0] to exist");
      const msg1 = messages[1];
      if (!msg1) throw new Error("Expected messages[1] to exist");
      expect(msg0.subject).toBe("Control Subject");
      expect(msg0.enrollmentId).toBe(enrollmentA!.id);
      expect(msg1.subject).toBe("Variant B Subject");
      expect(msg1.enrollmentId).toBe(enrollmentB!.id);
    });
  });

  it("falls back to config when abBucket is B but variantB is missing", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "sender@ab-fallback",
        })
        .returning();

      const [prospect] = await db
        .insert(tables.prospect)
        .values({ organizationId: orgA.id, email: "target@ab-fallback" })
        .returning();

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "AB Fallback Sequence",
          createdByUserId: orgA.userId,
        })
        .returning();

      // Step with config but NO variantB
      await db
        .insert(tables.sequenceStep)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          stepIndex: 0,
          stepType: "auto_email",
          config: {
            subject: "Only Config Subject",
            body_template: "Only Config Body",
            ai_generate: false,
          },
        })
        .returning();

      // Enrollment with abBucket: "B" but step has no variantB — should fallback to config
      const [enrollment] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          prospectId: prospect!.id,
          mailboxId: mailbox!.id,
          state: "active",
          abBucket: "B",
          currentStepIndex: 0,
          createdByUserId: orgA.userId,
        })
        .returning();

      // Message should use fallback config, not variantB (which doesn't exist)
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox!.id,
        prospectId: prospect!.id,
        enrollmentId: enrollment!.id,
        sequenceStepIndex: 0,
        direction: "outbound",
        status: "sent",
        subject: "Only Config Subject",
      });

      const messages = await db
        .select()
        .from(tables.message)
        .where(eq(tables.message.organizationId, orgA.id));

      expect(messages).toHaveLength(1);
      const msg = messages[0];
      if (!msg) throw new Error("Expected messages[0] to exist");
      expect(msg.subject).toBe("Only Config Subject");
    });
  });

  it("falls back to config when abBucket is null", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "sender@ab-null",
        })
        .returning();

      const [prospect] = await db
        .insert(tables.prospect)
        .values({ organizationId: orgA.id, email: "target@ab-null" })
        .returning();

      const [sequence] = await db
        .insert(tables.sequence)
        .values({ organizationId: orgA.id, name: "AB Null Sequence", createdByUserId: orgA.userId })
        .returning();

      // Step with both config and variantB
      await db
        .insert(tables.sequenceStep)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          stepIndex: 0,
          stepType: "auto_email",
          config: {
            subject: "Config for Null Bucket",
            body_template: "Config Body",
            ai_generate: false,
          },
          variantB: {
            subject: "Variant B for Null Bucket",
            body_template: "Variant B Body",
            ai_generate: false,
          },
        })
        .returning();

      // Enrollment with abBucket: null — should always use config, never variantB
      const [enrollment] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence!.id,
          prospectId: prospect!.id,
          mailboxId: mailbox!.id,
          state: "active",
          abBucket: null,
          currentStepIndex: 0,
          createdByUserId: orgA.userId,
        })
        .returning();

      // Message should use config, not variantB
      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox!.id,
        prospectId: prospect!.id,
        enrollmentId: enrollment!.id,
        sequenceStepIndex: 0,
        direction: "outbound",
        status: "sent",
        subject: "Config for Null Bucket",
      });

      const messages = await db
        .select()
        .from(tables.message)
        .where(eq(tables.message.organizationId, orgA.id));

      expect(messages).toHaveLength(1);
      const msg = messages[0];
      if (!msg) throw new Error("Expected messages[0] to exist");
      expect(msg.subject).toBe("Config for Null Bucket");
    });
  });
});
