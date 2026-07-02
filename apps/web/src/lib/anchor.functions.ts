import {
  transition,
  type EnrollmentSnapshot,
  type StepKind as SmStepKind,
} from "@quiksend/core/state-machine";
import { db, tables } from "@quiksend/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { applyWebEffects } from "./effect-executor.ts";
import { orgFn } from "./org-fn.ts";

type SequenceSettings = {
  timezone: string;
  throttle_seconds: number;
  mailbox_ids: string[];
  stop_on_reply: boolean;
  business_days_only: boolean;
};

export interface CaptureManualAnchorInput {
  readonly enrollmentId: string;
  readonly organizationId: string;
  readonly messageId: string;
  readonly threadId: string;
  readonly providerMessageId: string;
  readonly sentAt: Date;
}

export async function captureManualAnchorForEnrollment(
  input: CaptureManualAnchorInput,
): Promise<void> {
  const enrollment = await db.query.enrollment.findFirst({
    where: and(
      eq(tables.enrollment.id, input.enrollmentId),
      eq(tables.enrollment.organizationId, input.organizationId),
    ),
  });
  if (!enrollment) throw new Error("Enrollment not found");

  const steps = await db.query.sequenceStep.findMany({
    where: and(
      eq(tables.sequenceStep.sequenceId, enrollment.sequenceId),
      eq(tables.sequenceStep.organizationId, input.organizationId),
    ),
    orderBy: asc(tables.sequenceStep.stepIndex),
  });

  const sequence = await db.query.sequence.findFirst({
    where: and(
      eq(tables.sequence.id, enrollment.sequenceId),
      eq(tables.sequence.organizationId, input.organizationId),
    ),
  });
  if (!sequence) throw new Error("Sequence not found");

  const mailbox = await db.query.mailbox.findFirst({
    where: and(
      eq(tables.mailbox.id, enrollment.mailboxId),
      eq(tables.mailbox.organizationId, input.organizationId),
    ),
  });
  if (!mailbox) throw new Error("Mailbox not found");

  const settings = (sequence.settings ?? {}) as SequenceSettings;
  const nextStep = steps.find((s) => s.stepIndex === enrollment.currentStepIndex);
  const hasNext = steps.some((s) => s.stepIndex > enrollment.currentStepIndex);
  const snapshot: EnrollmentSnapshot = {
    state: enrollment.state as EnrollmentSnapshot["state"],
    currentStepIndex: enrollment.currentStepIndex,
    hasNextStep: hasNext,
    nextStepKind: (nextStep?.stepType as SmStepKind) ?? null,
    anchorMessageId: enrollment.anchorMessageId,
    attemptCount: enrollment.attemptCount,
  };

  const { nextState, effects } = transition(snapshot, {
    kind: "manual_sent",
    anchorMessageId: input.messageId,
    anchorThreadId: input.threadId,
    at: input.sentAt,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(tables.message)
      .set({
        enrollmentId: input.enrollmentId,
        providerMessageId: input.providerMessageId,
      })
      .where(
        and(
          eq(tables.message.messageIdHeader, input.messageId),
          eq(tables.message.organizationId, input.organizationId),
        ),
      );

    await applyWebEffects(tx, input.enrollmentId, input.organizationId, effects, {
      nextState,
      advanceContext: {
        steps,
        settings,
        mailbox,
        anchor: input.sentAt,
      },
      emitContext: {
        sequenceId: enrollment.sequenceId,
        prospectId: enrollment.prospectId,
      },
    });
  });
}

export const captureManualAnchor = orgFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        enrollmentId: z.string().uuid(),
        messageId: z.string().min(1),
        threadId: z.string().min(1),
        providerMessageId: z.string().min(1),
        sentAt: z.string().datetime(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await captureManualAnchorForEnrollment({
      enrollmentId: data.enrollmentId,
      organizationId: context.orgContext.organizationId,
      messageId: data.messageId,
      threadId: data.threadId,
      providerMessageId: data.providerMessageId,
      sentAt: new Date(data.sentAt),
    });
    return { ok: true };
  });
