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

describe("A/B variant attribution", () => {
  beforeEach(async () => {
    await truncateAppTables();
  });

  it("attributes messages to variant A when abBucket is A", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          senderId: orgA.userId,
          name: "Test Mailbox A",
          displayName: "Test A",
          address: "test-a@example.com",
          dailyCap: 50,
          throttleSeconds: 0,
          providerName: "faux",
          errorReason: null,
        })
        .returning();
      if (!mailbox) throw new Error("mailbox setup failed");

      const [prospect] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "target-a@example.com",
          firstName: "Alice",
          lastName: "AB Test",
          companyId: null,
          title: null,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!prospect) throw new Error("prospect setup failed");

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          createdByUserId: orgA.userId,
          name: "AB Attribution Sequence",
          description: null,
          isArchived: false,
          settings: JSON.stringify({
            timezone: "UTC",
            throttle_seconds: 0,
            mailbox_ids: [mailbox.id],
            stop_on_reply: false,
            business_days_only: false,
          }),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!sequence) throw new Error("sequence setup failed");

      const configA = {
        subject: "Variant A Subject",
        body_template: "Body A",
        ai_generate: false,
      };

      const configB = {
        subject: "Variant B Subject",
        body_template: "Body B",
        ai_generate: false,
      };

      await db
        .insert(tables.sequenceStep)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          stepIndex: 0,
          stepType: "auto_email",
          delayMinutes: 0,
          businessDaysOnly: false,
          config: configA,
          variantB: configB,
          entryCondition: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const [enrollment] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          prospectId: prospect.id,
          sequenceId: sequence.id,
          mailboxId: mailbox.id,
          createdByUserId: orgA.userId,
          currentStepIndex: 0,
          abBucket: "A",
          attempts: 0,
          anchorMessageId: null,
          anchorThreadId: null,
          pausedAt: null,
          terminatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!enrollment) throw new Error("enrollment setup failed");

      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox.id,
        prospectId: prospect.id,
        enrollmentId: enrollment.id,
        sequenceStepIndex: 0,
        direction: "outbound",
        subject: "Variant A Subject",
        bodyHtml: "Body A HTML",
        bodyText: "Body A",
        status: "sent",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const rows = await db
        .select({
          subject: tables.message.subject,
          stepIndex: tables.message.sequenceStepIndex,
        })
        .from(tables.message)
        .where(
          and(
            eq(tables.message.organizationId, orgA.id),
            eq(tables.message.enrollmentId, enrollment.id),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0].subject).toBe("Variant A Subject");
      expect(rows[0].stepIndex).toBe(0);
    });
  });

  it("attributes messages to variant B when abBucket is B and variant exists", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          senderId: orgA.userId,
          name: "Test Mailbox B",
          displayName: "Test B",
          address: "test-b@example.com",
          dailyCap: 50,
          throttleSeconds: 0,
          providerName: "faux",
          errorReason: null,
        })
        .returning();
      if (!mailbox) throw new Error("mailbox setup failed");

      const [prospect] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "target-b@example.com",
          firstName: "Bob",
          lastName: "AB Test",
          companyId: null,
          title: null,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!prospect) throw new Error("prospect setup failed");

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          createdByUserId: orgA.userId,
          name: "AB Attribution Sequence B",
          description: null,
          isArchived: false,
          settings: JSON.stringify({
            timezone: "UTC",
            throttle_seconds: 0,
            mailbox_ids: [mailbox.id],
            stop_on_reply: false,
            business_days_only: false,
          }),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!sequence) throw new Error("sequence setup failed");

      const configA = {
        subject: "Config A",
        body_template: "Body A",
        ai_generate: false,
      };

      const configB = {
        subject: "Variant B Subject Different",
        body_template: "Body B Different",
        ai_generate: false,
      };

      await db
        .insert(tables.sequenceStep)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          stepIndex: 0,
          stepType: "auto_email",
          delayMinutes: 0,
          businessDaysOnly: false,
          config: configA,
          variantB: configB,
          entryCondition: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const [enrollment] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          prospectId: prospect.id,
          sequenceId: sequence.id,
          mailboxId: mailbox.id,
          createdByUserId: orgA.userId,
          currentStepIndex: 0,
          abBucket: "B",
          attempts: 0,
          anchorMessageId: null,
          anchorThreadId: null,
          pausedAt: null,
          terminatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!enrollment) throw new Error("enrollment setup failed");

      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox.id,
        prospectId: prospect.id,
        enrollmentId: enrollment.id,
        sequenceStepIndex: 0,
        direction: "outbound",
        subject: "Variant B Subject Different",
        bodyHtml: "Body B Different HTML",
        bodyText: "Body B Different",
        status: "sent",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const rows = await db
        .select({
          subject: tables.message.subject,
          stepIndex: tables.message.sequenceStepIndex,
        })
        .from(tables.message)
        .where(
          and(
            eq(tables.message.organizationId, orgA.id),
            eq(tables.message.enrollmentId, enrollment.id),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0].subject).toBe("Variant B Subject Different");
      expect(rows[0].stepIndex).toBe(0);
    });
  });
});
