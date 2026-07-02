import { computeSchedule } from "@quiksend/core/schedule";
import type { MailboxSchedule, SendingWindow, StepKind, Weekday } from "@quiksend/core/schedule";
import { db, tables } from "@quiksend/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { orgFn } from "./org-fn.ts";

type SequenceSettings = {
  timezone: string;
  throttle_seconds: number;
  mailbox_ids: string[];
  stop_on_reply: boolean;
  business_days_only: boolean;
};

function parseSettings(raw: unknown): SequenceSettings {
  const s = (raw ?? {}) as Partial<SequenceSettings>;
  return {
    timezone: s.timezone ?? "UTC",
    throttle_seconds: s.throttle_seconds ?? 90,
    mailbox_ids: s.mailbox_ids ?? [],
    stop_on_reply: s.stop_on_reply ?? true,
    business_days_only: s.business_days_only ?? true,
  };
}

function toMailboxSchedule(
  sendWindow: unknown,
  mailbox: { dailyCap: number; throttleSeconds: number },
  settings: SequenceSettings,
): MailboxSchedule {
  const sw = (sendWindow ?? { window: {} }) as {
    timezone?: string;
    window: Record<string, [number, number][]>;
  };
  const window: SendingWindow = {};
  for (const [day, ranges] of Object.entries(sw.window ?? {})) {
    window[day as Weekday] = ranges.map(([start, end]) => ({
      startHour: start,
      endHour: end,
    }));
  }
  return {
    timezone: settings.timezone || sw.timezone || "UTC",
    window,
    dailyCap: mailbox.dailyCap,
    minGapSeconds: settings.throttle_seconds ?? mailbox.throttleSeconds,
  };
}

function computeNextRunAt(
  steps: { stepIndex: number; stepType: string; delayMinutes: number; businessDaysOnly: boolean }[],
  settings: SequenceSettings,
  mailbox: typeof tables.mailbox.$inferSelect,
  stepIndex: number,
  anchor: Date,
): Date | null {
  const specs = steps.map((s) => ({
    index: s.stepIndex,
    kind: s.stepType as StepKind,
    delayMinutes: s.delayMinutes,
    businessDaysOnly: s.businessDaysOnly && settings.business_days_only,
  }));
  const schedule = computeSchedule(
    specs,
    toMailboxSchedule(mailbox.sendWindow, mailbox, settings),
    anchor,
  );
  return schedule.find((s) => s.index === stepIndex)?.scheduledAt ?? null;
}

export const enrollWithExistingAnchor = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        prospectId: z.string().uuid(),
        sequenceId: z.string().uuid(),
        existingMessageId: z.string().uuid(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { organizationId, userId } = context.orgContext;

    const message = await db.query.message.findFirst({
      where: and(
        eq(tables.message.id, data.existingMessageId),
        eq(tables.message.organizationId, organizationId),
        eq(tables.message.direction, "outbound"),
      ),
    });
    if (!message?.messageIdHeader || !message.sentAt) {
      throw new Error("Anchor message not found or missing send metadata");
    }

    const sequence = await db.query.sequence.findFirst({
      where: and(
        eq(tables.sequence.id, data.sequenceId),
        eq(tables.sequence.organizationId, organizationId),
      ),
    });
    if (!sequence || sequence.status !== "active") {
      throw new Error("Sequence not found or not active");
    }

    const steps = await db.query.sequenceStep.findMany({
      where: and(
        eq(tables.sequenceStep.sequenceId, sequence.id),
        eq(tables.sequenceStep.organizationId, organizationId),
      ),
      orderBy: asc(tables.sequenceStep.stepIndex),
    });
    const firstStep = steps[0];
    if (!firstStep) throw new Error("Sequence has no steps");

    const settings = parseSettings(sequence.settings);
    const mailboxId = message.mailboxId ?? settings.mailbox_ids?.[0];
    if (!mailboxId) throw new Error("No mailbox available for enrollment");

    const mailbox = await db.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, mailboxId),
        eq(tables.mailbox.organizationId, organizationId),
      ),
    });
    if (!mailbox) throw new Error("Mailbox not found for enrollment");

    const nextRunAt = computeNextRunAt(steps, settings, mailbox, 0, message.sentAt);
    if (!nextRunAt) throw new Error("Could not compute next run time for enrollment");

    const [enrollment] = await db
      .insert(tables.enrollment)
      .values({
        organizationId,
        sequenceId: data.sequenceId,
        prospectId: data.prospectId,
        mailboxId,
        state: "active",
        currentStepIndex: 0,
        nextRunAt,
        anchorMessageId: message.messageIdHeader,
        anchorThreadId: message.providerThreadId,
        createdByUserId: userId,
      })
      .returning();

    if (!enrollment) throw new Error("Failed to create enrollment");

    await db
      .update(tables.message)
      .set({ enrollmentId: enrollment.id })
      .where(eq(tables.message.id, message.id));

    return { enrollmentId: enrollment.id };
  });
