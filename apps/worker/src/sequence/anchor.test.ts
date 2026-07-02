import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import { captureManualAnchor } from "./anchor.ts";

const WIDE_WINDOW = {
  timezone: "UTC",
  window: {
    sun: [[0, 24]],
    mon: [[0, 24]],
    tue: [[0, 24]],
    wed: [[0, 24]],
    thu: [[0, 24]],
    fri: [[0, 24]],
    sat: [[0, 24]],
  },
};

describe("captureManualAnchor", () => {
  beforeEach(() => {
    process.env.QUIKSEND_ENGINE_FAKE_MAIL = "1";
  });

  afterEach(() => {
    delete process.env.QUIKSEND_ENGINE_FAKE_MAIL;
  });

  it("persists anchor metadata and schedules the next step from sentAt", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "sender@anchor.test",
          dailyCap: 50,
          throttleSeconds: 0,
          sendWindow: WIDE_WINDOW,
          status: "active",
        })
        .returning();
      if (!mailbox) throw new Error("setup failed");

      const [prospect] = await db
        .insert(tables.prospect)
        .values({
          organizationId: orgA.id,
          email: "prospect@anchor.test",
        })
        .returning();
      if (!prospect) throw new Error("setup failed");

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Anchor Sequence",
          status: "active",
          settings: {
            timezone: "UTC",
            throttle_seconds: 0,
            mailbox_ids: [mailbox.id],
            stop_on_reply: true,
            business_days_only: false,
          },
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!sequence) throw new Error("setup failed");

      await db.insert(tables.sequenceStep).values({
        organizationId: orgA.id,
        sequenceId: sequence.id,
        stepIndex: 0,
        stepType: "manual_email",
        delayMinutes: 0,
        config: { subject: "Hi", body_template: "<p>Hi</p>", ai_generate: false },
      });

      await db.insert(tables.sequenceStep).values({
        organizationId: orgA.id,
        sequenceId: sequence.id,
        stepIndex: 1,
        stepType: "auto_email",
        delayMinutes: 60,
        config: {
          subject: "Follow up",
          body_template: "<p>Follow up</p>",
          ai_generate: false,
        },
      });

      const [enrollment] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          prospectId: prospect.id,
          mailboxId: mailbox.id,
          state: "waiting_manual",
          currentStepIndex: 0,
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!enrollment) throw new Error("setup failed");

      const rawMessageId = "abc123@anchor.test";
      const sentAt = new Date("2026-03-15T10:00:00.000Z");
      const [message] = await db
        .insert(tables.message)
        .values({
          organizationId: orgA.id,
          mailboxId: mailbox.id,
          prospectId: prospect.id,
          direction: "outbound",
          subject: "Hi",
          messageIdHeader: rawMessageId,
          providerMessageId: "provider-manual",
          providerThreadId: "thread-manual",
          status: "sent",
          sentAt,
        })
        .returning();
      if (!message) throw new Error("setup failed");

      await captureManualAnchor({
        enrollmentId: enrollment.id,
        messageId: rawMessageId,
        threadId: "thread-manual",
        providerMessageId: "provider-manual",
        sentAt,
      });

      const updated = await db.query.enrollment.findFirst({
        where: and(
          eq(tables.enrollment.id, enrollment.id),
          eq(tables.enrollment.organizationId, orgA.id),
        ),
      });
      if (!updated) throw new Error("enrollment missing after capture");

      expect(updated.anchorMessageId).toBe(rawMessageId);
      expect(updated.anchorThreadId).toBe("thread-manual");
      expect(updated.state).toBe("active");
      expect(updated.currentStepIndex).toBe(1);
      expect(updated.nextRunAt).not.toBeNull();
      expect(updated.nextRunAt!.getTime()).toBeGreaterThan(sentAt.getTime());

      const linked = await db.query.message.findFirst({
        where: eq(tables.message.id, message.id),
      });
      expect(linked?.enrollmentId).toBe(enrollment.id);
    });
  });
});
