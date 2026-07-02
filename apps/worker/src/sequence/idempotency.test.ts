import { transition } from "@quiksend/core/state-machine";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import { createFakeAdapter } from "@quiksend/mail";
import { applyTransitionEffects } from "./effects.ts";
import { makeIdempotencyKey } from "./idempotency.ts";
import { loadContext } from "./load-context.ts";
import { toSnapshot } from "./context.ts";

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

const fake = createFakeAdapter();

vi.mock("./mailbox-adapter.ts", () => ({
  createMailboxAdapter: () => fake.adapter,
}));

describe("idempotency skip-send", () => {
  beforeEach(() => {
    fake.state.sent.length = 0;
    process.env.QUIKSEND_ENGINE_FAKE_MAIL = "1";
  });

  afterEach(() => {
    delete process.env.QUIKSEND_ENGINE_FAKE_MAIL;
  });

  it("skips adapter.send when a sent message already exists for the idempotency key", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const [mailbox] = await db
        .insert(tables.mailbox)
        .values({
          organizationId: orgA.id,
          ownerUserId: orgA.userId,
          provider: "smtp",
          address: "sender@idempotency.test",
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
          email: "prospect@idempotency.test",
          firstName: "Pat",
        })
        .returning();
      if (!prospect) throw new Error("setup failed");

      const [sequence] = await db
        .insert(tables.sequence)
        .values({
          organizationId: orgA.id,
          name: "Idempotency Sequence",
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

      const [manualStep] = await db
        .insert(tables.sequenceStep)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          stepIndex: 0,
          stepType: "manual_email",
          delayMinutes: 0,
          config: { subject: "Hi", body_template: "<p>Hi</p>", ai_generate: false },
        })
        .returning();
      if (!manualStep) throw new Error("setup failed");

      const [autoStep] = await db
        .insert(tables.sequenceStep)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          stepIndex: 1,
          stepType: "auto_email",
          delayMinutes: 0,
          config: {
            subject: "Follow up",
            body_template: "<p>Follow up</p>",
            ai_generate: false,
          },
        })
        .returning();
      if (!autoStep) throw new Error("setup failed");

      await db.insert(tables.sequenceStep).values({
        organizationId: orgA.id,
        sequenceId: sequence.id,
        stepIndex: 2,
        stepType: "wait",
        delayMinutes: 60,
        config: { minutes: 60 },
      });

      const anchorMessageId = "<anchor@idempotency.test>";
      const [anchorMessage] = await db
        .insert(tables.message)
        .values({
          organizationId: orgA.id,
          mailboxId: mailbox.id,
          prospectId: prospect.id,
          direction: "outbound",
          subject: "Hi",
          messageIdHeader: anchorMessageId,
          providerMessageId: "provider-anchor",
          providerThreadId: "thread-anchor",
          status: "sent",
          sentAt: new Date("2026-01-01T12:00:00.000Z"),
        })
        .returning();
      if (!anchorMessage) throw new Error("setup failed");

      const [enrollment] = await db
        .insert(tables.enrollment)
        .values({
          organizationId: orgA.id,
          sequenceId: sequence.id,
          prospectId: prospect.id,
          mailboxId: mailbox.id,
          state: "active",
          currentStepIndex: 1,
          anchorMessageId,
          anchorThreadId: "thread-anchor",
          createdByUserId: orgA.userId,
        })
        .returning();
      if (!enrollment) throw new Error("setup failed");

      const attempt = 0;
      const idempotencyKey = makeIdempotencyKey(enrollment.id, autoStep.id, attempt);

      await db.insert(tables.message).values({
        organizationId: orgA.id,
        mailboxId: mailbox.id,
        prospectId: prospect.id,
        enrollmentId: enrollment.id,
        direction: "outbound",
        subject: "Follow up",
        messageIdHeader: "<already-sent@idempotency.test>",
        providerMessageId: "provider-retry",
        status: "sent",
        sentAt: new Date("2026-01-02T12:00:00.000Z"),
        idempotencyKey,
      });

      const ctx = await loadContext(enrollment.id);
      const snapshot = toSnapshot(ctx);
      const tick = transition(snapshot, { kind: "tick", at: new Date() });

      await db.transaction(async (tx) => {
        await applyTransitionEffects(tx, ctx, tick.effects, attempt, tick.nextState);
      });

      expect(fake.state.sent).toHaveLength(0);

      const updated = await db.query.enrollment.findFirst({
        where: and(
          eq(tables.enrollment.id, enrollment.id),
          eq(tables.enrollment.organizationId, orgA.id),
        ),
      });
      expect(updated?.currentStepIndex).toBe(2);

      const messages = await db.query.message.findMany({
        where: eq(tables.message.idempotencyKey, idempotencyKey),
      });
      expect(messages).toHaveLength(1);
    });
  });
});
