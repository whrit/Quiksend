import type { Effect } from "@quiksend/core/state-machine";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { applyWebEffects, WebOnlyEffectError, type DrizzleTransaction } from "./effect-executor.ts";

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

async function seedEnrollment(orgId: string, userId: string) {
  const [mailbox] = await db
    .insert(tables.mailbox)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      provider: "smtp",
      address: `sender-${userId}@effect.test`,
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
      organizationId: orgId,
      email: `prospect-${userId}@effect.test`,
    })
    .returning();
  if (!prospect) throw new Error("setup failed");

  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: orgId,
      name: "Effect Sequence",
      status: "active",
      settings: {
        timezone: "UTC",
        throttle_seconds: 0,
        mailbox_ids: [mailbox.id],
        stop_on_reply: true,
        business_days_only: false,
      },
      createdByUserId: userId,
    })
    .returning();
  if (!sequence) throw new Error("setup failed");

  await db.insert(tables.sequenceStep).values({
    organizationId: orgId,
    sequenceId: sequence.id,
    stepIndex: 0,
    stepType: "manual_email",
    delayMinutes: 0,
    config: { subject: "Hi", body_template: "<p>Hi</p>", ai_generate: false },
  });

  const [enrollment] = await db
    .insert(tables.enrollment)
    .values({
      organizationId: orgId,
      sequenceId: sequence.id,
      prospectId: prospect.id,
      mailboxId: mailbox.id,
      state: "waiting_manual",
      currentStepIndex: 0,
      createdByUserId: userId,
    })
    .returning();
  if (!enrollment) throw new Error("setup failed");

  return { mailbox, prospect, sequence, enrollment };
}

describe("applyWebEffects", () => {
  it("throws WebOnlyEffectError for worker-only effects", async () => {
    const mockTx = {
      query: { enrollment: { findFirst: vi.fn<() => Promise<undefined>>() } },
      update: vi.fn<() => Promise<unknown>>(),
      insert: vi.fn<() => Promise<unknown>>(),
    } as unknown as DrizzleTransaction;

    const workerEffects: Effect[] = [
      { kind: "send_auto", stepIndex: 0 },
      { kind: "create_compose_task", stepIndex: 0 },
      { kind: "create_task", stepIndex: 0 },
      { kind: "increment_attempt" },
    ];

    for (const effect of workerEffects) {
      await expect(
        applyWebEffects(mockTx, "enrollment-id", "org-id", [effect]),
      ).rejects.toBeInstanceOf(WebOnlyEffectError);
    }
  });

  it("applies capture_anchor, advance_step, schedule_at, emit_event, and terminate", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const { enrollment, sequence, prospect } = await seedEnrollment(orgA.id, orgA.userId);
      const scheduledAt = new Date("2026-06-01T12:00:00Z");

      await db.transaction(async (tx) => {
        await applyWebEffects(
          tx,
          enrollment.id,
          orgA.id,
          [
            { kind: "capture_anchor", messageId: "<anchor@effect.test>", threadId: "thread-1" },
            { kind: "advance_step" },
            { kind: "schedule_at", at: scheduledAt },
            { kind: "emit_event", type: "enrollment.paused" },
            { kind: "terminate", reason: "stopped" },
          ],
          {
            nextState: "stopped",
            emitContext: {
              sequenceId: sequence.id,
              prospectId: prospect.id,
            },
          },
        );
      });

      const updated = await db.query.enrollment.findFirst({
        where: and(
          eq(tables.enrollment.id, enrollment.id),
          eq(tables.enrollment.organizationId, orgA.id),
        ),
      });
      expect(updated?.anchorMessageId).toBe("<anchor@effect.test>");
      expect(updated?.anchorThreadId).toBe("thread-1");
      expect(updated?.currentStepIndex).toBe(1);
      expect(updated?.nextRunAt).toBeNull();
      expect(updated?.state).toBe("stopped");

      const events = await db.query.event.findMany({
        where: and(
          eq(tables.event.organizationId, orgA.id),
          eq(tables.event.entityId, enrollment.id),
        ),
      });
      expect(events.some((e) => e.type === "enrollment.paused")).toBe(true);
    });
  });
});
