import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { effectiveStepConfig } from "./context.ts";
import { loadContext } from "./load-context.ts";

describe("A/B variant execution", () => {
  beforeEach(() => {
    process.env.QUIKSEND_ENGINE_FAKE_MAIL = "1";
  });

  afterEach(() => {
    delete process.env.QUIKSEND_ENGINE_FAKE_MAIL;
  });

  it("uses variant B config when enrollment.abBucket is B and variant exists", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          senderId: orgA.userId,
          name: "Test Mailbox",
          displayName: "Test",
          address: "test@example.com",
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
          email: "target@example.com",
          firstName: "Alice",
          lastName: "Test",
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
          name: "AB Test Sequence",
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
        subject: "Subject A",
        body_template: "Body A",
        ai_generate: false,
      };

      const configB = {
        subject: "Subject B",
        body_template: "Body B",
        ai_generate: false,
      };

      const [step] = await db
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
        })
        .returning();
      if (!step) throw new Error("step setup failed");

      const [enrollmentA] = await db
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
      if (!enrollmentA) throw new Error("enrollmentA setup failed");

      const [enrollmentB] = await db
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
      if (!enrollmentB) throw new Error("enrollmentB setup failed");

      const ctxA = await loadContext(enrollmentA.id, orgA.id);
      const ctxB = await loadContext(enrollmentB.id, orgA.id);

      const stepA = ctxA.steps.find((s) => s.stepIndex === 0);
      const stepB = ctxB.steps.find((s) => s.stepIndex === 0);

      if (!stepA || !stepB) throw new Error("step not found in context");

      const effectiveA = effectiveStepConfig(ctxA, stepA);
      const effectiveB = effectiveStepConfig(ctxB, stepB);

      expect(effectiveA).toEqual(configA);
      expect(effectiveB).toEqual(configB);
      expect(effectiveA.subject).toBe("Subject A");
      expect(effectiveB.subject).toBe("Subject B");
    });
  });

  it("falls back to config when variant B does not exist", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          senderId: orgA.userId,
          name: "Test Mailbox",
          displayName: "Test",
          address: "test@example.com",
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
          email: "target@example.com",
          firstName: "Bob",
          lastName: "Test",
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
          name: "No Variant Sequence",
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
        subject: "Only Config",
        body_template: "Only Body",
        ai_generate: false,
      };

      const [step] = await db
        .insert(tables.sequenceStep)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          stepIndex: 0,
          stepType: "auto_email",
          delayMinutes: 0,
          businessDaysOnly: false,
          config: configA,
          variantB: null,
          entryCondition: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!step) throw new Error("step setup failed");

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

      const ctx = await loadContext(enrollment.id, orgA.id);
      const stepCtx = ctx.steps.find((s) => s.stepIndex === 0);
      if (!stepCtx) throw new Error("step not found in context");

      const effective = effectiveStepConfig(ctx, stepCtx);
      expect(effective).toEqual(configA);
      expect(effective.subject).toBe("Only Config");
    });
  });

  it("preserves bucket assignment across retries", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          senderId: orgA.userId,
          name: "Test Mailbox",
          displayName: "Test",
          address: "test@example.com",
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
          email: "target@example.com",
          firstName: "Charlie",
          lastName: "Test",
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
          name: "Retry Stability Sequence",
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
        subject: "Retry A",
        body_template: "Retry Body A",
        ai_generate: false,
      };

      const configB = {
        subject: "Retry B",
        body_template: "Retry Body B",
        ai_generate: false,
      };

      const [step] = await db
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
        })
        .returning();
      if (!step) throw new Error("step setup failed");

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

      const ctx1 = await loadContext(enrollment.id, orgA.id);
      const step1 = ctx1.steps.find((s) => s.stepIndex === 0);
      if (!step1) throw new Error("step not found in context");
      const effective1 = effectiveStepConfig(ctx1, step1);

      await db
        .update(tables.enrollment)
        .set({ attempts: 1, updatedAt: new Date() })
        .where(eq(tables.enrollment.id, enrollment.id));

      const ctx2 = await loadContext(enrollment.id, orgA.id);
      const step2 = ctx2.steps.find((s) => s.stepIndex === 0);
      if (!step2) throw new Error("step not found in context");
      const effective2 = effectiveStepConfig(ctx2, step2);

      expect(effective1).toEqual(configB);
      expect(effective2).toEqual(configB);
      expect(effective1.subject).toBe(effective2.subject);
      expect(effective1.subject).toBe("Retry B");
    });
  });
});
