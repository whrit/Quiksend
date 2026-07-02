import { transition } from "@quiksend/core/state-machine";
import { db, tables } from "@quiksend/db";
import { and, asc, eq } from "drizzle-orm";
import { computeNextRunAt } from "./context.ts";
import { applyTransitionEffects } from "./effects.ts";
import { loadContext } from "./load-context.ts";
import { toSnapshot } from "./context.ts";

export interface CaptureManualAnchorInput {
  readonly enrollmentId: string;
  readonly messageId: string;
  readonly threadId: string;
  readonly providerMessageId: string;
  readonly sentAt: Date;
}

export async function captureManualAnchor(input: CaptureManualAnchorInput): Promise<void> {
  const ctx = await loadContext(input.enrollmentId);
  const at = input.sentAt;

  const snapshot = toSnapshot(ctx);
  const { nextState, effects } = transition(snapshot, {
    kind: "manual_sent",
    anchorMessageId: input.messageId,
    anchorThreadId: input.threadId,
    at,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(tables.message)
      .set({
        enrollmentId: ctx.enrollmentId,
        providerMessageId: input.providerMessageId,
      })
      .where(
        and(
          eq(tables.message.messageIdHeader, input.messageId),
          eq(tables.message.organizationId, ctx.organizationId),
        ),
      );

    let working = await applyTransitionEffects(tx, ctx, effects, 0, nextState);

    const nextRunAt = computeNextRunAt(working, working.enrollment.currentStepIndex);
    if (nextRunAt) {
      const [updated] = await tx
        .update(tables.enrollment)
        .set({ nextRunAt })
        .where(
          and(
            eq(tables.enrollment.id, working.enrollmentId),
            eq(tables.enrollment.organizationId, working.organizationId),
          ),
        )
        .returning();
      if (updated) working = { ...working, enrollment: updated };
    }
  });
}

export interface EnrollWithExistingAnchorInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly prospectId: string;
  readonly sequenceId: string;
  readonly existingMessageId: string;
}

export async function enrollWithExistingAnchor(
  input: EnrollWithExistingAnchorInput,
): Promise<string> {
  const message = await db.query.message.findFirst({
    where: and(
      eq(tables.message.id, input.existingMessageId),
      eq(tables.message.organizationId, input.organizationId),
      eq(tables.message.direction, "outbound"),
    ),
  });
  if (!message?.messageIdHeader || !message.sentAt) {
    throw new Error("Anchor message not found or missing send metadata");
  }

  const sequence = await db.query.sequence.findFirst({
    where: and(
      eq(tables.sequence.id, input.sequenceId),
      eq(tables.sequence.organizationId, input.organizationId),
    ),
  });
  if (!sequence || sequence.status !== "active") {
    throw new Error("Sequence not found or not active");
  }

  const steps = await db.query.sequenceStep.findMany({
    where: and(
      eq(tables.sequenceStep.sequenceId, sequence.id),
      eq(tables.sequenceStep.organizationId, input.organizationId),
    ),
    orderBy: asc(tables.sequenceStep.stepIndex),
  });
  const firstStep = steps[0];
  if (!firstStep) throw new Error("Sequence has no steps");

  const settings = (sequence.settings ?? {}) as {
    mailbox_ids?: string[];
  };
  const mailboxId = message.mailboxId ?? settings.mailbox_ids?.[0];
  if (!mailboxId) throw new Error("No mailbox available for enrollment");

  const anchor = message.sentAt;
  const delayMs = firstStep.delayMinutes * 60 * 1000;
  const nextRunAt = new Date(anchor.getTime() + delayMs);

  const [enrollment] = await db
    .insert(tables.enrollment)
    .values({
      organizationId: input.organizationId,
      sequenceId: input.sequenceId,
      prospectId: input.prospectId,
      mailboxId,
      state: "active",
      currentStepIndex: 0,
      nextRunAt,
      anchorMessageId: message.messageIdHeader,
      anchorThreadId: message.providerThreadId,
      createdByUserId: input.userId,
    })
    .returning();

  if (!enrollment) throw new Error("Failed to create enrollment");

  await db
    .update(tables.message)
    .set({ enrollmentId: enrollment.id })
    .where(eq(tables.message.id, message.id));

  return enrollment.id;
}
