import { transition, type Effect, type EnrollmentState } from "@quiksend/core/state-machine";
import { isSegGateway } from "@quiksend/core/deliverability";
import { env } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import {
  buildComplianceParts,
  buildUnsubscribeUrl,
  mintUnsubscribeToken,
  sanitizeForSeg,
} from "@quiksend/mail";
import { buildThreadingHeaders, normalizeMessageId } from "@quiksend/mail/threading";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@quiksend/db/schema";
import { backoffUntil } from "./backoff.ts";
import {
  computeNextRunAt,
  toSnapshot,
  type EmailStepConfig,
  type EnrollmentContext,
  type TaskStepConfig,
} from "./context.ts";
import { enqueueSequenceStepAt, makeIdempotencyKey } from "./idempotency.ts";
import { createMailboxAdapter } from "./mailbox-adapter.ts";
import { renderTemplate, stripHtml } from "./render-template.ts";
import {
  markReservationSentInTx,
  releaseReservationInTx,
  reserveSendSlotInTx,
} from "./reserve-slot.ts";
import { handleEmitEvent } from "./execute-effects.ts";
import { getWorkspacePostalAddress } from "./workspace-postal.ts";
import { selectMailboxForSend } from "./mailbox-router.ts";

type DbTx = PostgresJsDatabase<typeof schema>;

const MAX_STEP_ATTEMPTS = 5;

export function maxStepAttempts(): number {
  return MAX_STEP_ATTEMPTS;
}

export async function applyTransitionEffects(
  tx: DbTx,
  ctx: EnrollmentContext,
  effects: readonly Effect[],
  attempt: number,
  nextState: EnrollmentState,
): Promise<EnrollmentContext> {
  let working = ctx;

  for (const effect of effects) {
    switch (effect.kind) {
      case "send_auto":
        working = await handleSendAuto(tx, working, effect.stepIndex, attempt);
        break;
      case "create_compose_task":
        await createComposeTask(tx, working, effect.stepIndex);
        break;
      case "create_task":
        await createGenericTask(tx, working, effect.stepIndex);
        break;
      case "advance_step":
        working = await advanceStep(tx, working);
        break;
      case "capture_anchor":
        working = await captureAnchor(tx, working, effect.messageId, effect.threadId);
        break;
      case "emit_event":
        await handleEmitEvent(tx, working, effect.type);
        break;
      case "terminate":
        working = await terminateInTx(tx, working, effect.reason);
        break;
      case "increment_attempt":
        working = await incrementAttempt(tx, working);
        break;
      case "schedule_at":
        working = await scheduleAt(tx, working, effect.at);
        break;
    }
  }

  const effectChangedState = working.enrollment.state !== ctx.enrollment.state;
  const finalState: EnrollmentState = effectChangedState
    ? (working.enrollment.state as EnrollmentState)
    : nextState;

  if (finalState !== working.enrollment.state) {
    const [updated] = await tx
      .update(tables.enrollment)
      .set({ state: finalState })
      .where(
        and(
          eq(tables.enrollment.id, working.enrollmentId),
          eq(tables.enrollment.organizationId, working.organizationId),
        ),
      )
      .returning();
    if (updated) working = { ...working, enrollment: updated };
  }

  return working;
}

async function createComposeTask(
  tx: DbTx,
  ctx: EnrollmentContext,
  stepIndex: number,
): Promise<void> {
  const step = ctx.steps.find((s) => s.stepIndex === stepIndex);
  if (!step) return;
  const config = step.config as EmailStepConfig;
  await tx.insert(tables.task).values({
    organizationId: ctx.organizationId,
    enrollmentId: ctx.enrollmentId,
    stepId: step.id,
    type: "compose",
    title: config.subject || "Compose email",
    instructions: config.body_template,
    dueAt: new Date(),
    status: "open",
    assignedUserId: ctx.mailbox.ownerUserId,
  });
}

async function createGenericTask(
  tx: DbTx,
  ctx: EnrollmentContext,
  stepIndex: number,
): Promise<void> {
  const step = ctx.steps.find((s) => s.stepIndex === stepIndex);
  if (!step) return;
  const config = step.config as TaskStepConfig;
  await tx.insert(tables.task).values({
    organizationId: ctx.organizationId,
    enrollmentId: ctx.enrollmentId,
    stepId: step.id,
    type: "generic",
    title: config.title,
    instructions: config.instructions,
    dueAt: new Date(),
    status: "open",
    assignedUserId: ctx.mailbox.ownerUserId,
  });
}

async function advanceStep(tx: DbTx, ctx: EnrollmentContext): Promise<EnrollmentContext> {
  const nextIndex = ctx.enrollment.currentStepIndex + 1;
  const nextRunAt = computeNextRunAt(ctx, nextIndex);
  const [updated] = await tx
    .update(tables.enrollment)
    .set({
      currentStepIndex: nextIndex,
      nextRunAt,
      attemptCount: 0,
      lastError: null,
    })
    .where(
      and(
        eq(tables.enrollment.id, ctx.enrollmentId),
        eq(tables.enrollment.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Failed to advance enrollment step");
  return { ...ctx, enrollment: updated };
}

async function captureAnchor(
  tx: DbTx,
  ctx: EnrollmentContext,
  messageId: string,
  threadId: string,
): Promise<EnrollmentContext> {
  const [updated] = await tx
    .update(tables.enrollment)
    .set({
      anchorMessageId: messageId,
      anchorThreadId: threadId,
    })
    .where(
      and(
        eq(tables.enrollment.id, ctx.enrollmentId),
        eq(tables.enrollment.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Failed to capture anchor");
  return { ...ctx, enrollment: updated };
}

async function terminateInTx(
  tx: DbTx,
  ctx: EnrollmentContext,
  reason: EnrollmentState,
): Promise<EnrollmentContext> {
  const [updated] = await tx
    .update(tables.enrollment)
    .set({
      state: reason,
      nextRunAt: null,
    })
    .where(
      and(
        eq(tables.enrollment.id, ctx.enrollmentId),
        eq(tables.enrollment.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Failed to terminate enrollment");
  return { ...ctx, enrollment: updated };
}

async function incrementAttempt(tx: DbTx, ctx: EnrollmentContext): Promise<EnrollmentContext> {
  const [updated] = await tx
    .update(tables.enrollment)
    .set({
      attemptCount: ctx.enrollment.attemptCount + 1,
    })
    .where(
      and(
        eq(tables.enrollment.id, ctx.enrollmentId),
        eq(tables.enrollment.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Failed to increment attempt");
  return { ...ctx, enrollment: updated };
}

async function scheduleAt(tx: DbTx, ctx: EnrollmentContext, at: Date): Promise<EnrollmentContext> {
  const [updated] = await tx
    .update(tables.enrollment)
    .set({ nextRunAt: at })
    .where(
      and(
        eq(tables.enrollment.id, ctx.enrollmentId),
        eq(tables.enrollment.organizationId, ctx.organizationId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Failed to schedule enrollment");
  return { ...ctx, enrollment: updated };
}

async function handleSendAuto(
  tx: DbTx,
  ctx: EnrollmentContext,
  stepIndex: number,
  attempt: number,
): Promise<EnrollmentContext> {
  const step = ctx.steps.find((s) => s.stepIndex === stepIndex);
  if (!step || step.stepType !== "auto_email") return ctx;

  const at = new Date();
  let working = ctx;

  const routing = await selectMailboxForSend(
    tx,
    ctx.organizationId,
    ctx.enrollment,
    ctx.mailbox,
    ctx.prospect.emailGateway,
    ctx.deliverabilityPolicy,
    at,
  );

  if (routing.kind === "skip") {
    const snapshot = toSnapshot(working);
    const result = transition(snapshot, { kind: "no_safe_mailbox", at });
    return applyTransitionEffects(tx, working, result.effects, attempt, result.nextState);
  }

  for (const eventType of routing.emitEvents) {
    await handleEmitEvent(tx, working, eventType);
  }

  if (routing.mailboxId !== working.mailbox.id) {
    const swapped = await tx.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, routing.mailboxId),
        eq(tables.mailbox.organizationId, working.organizationId),
      ),
    });
    if (!swapped) throw new Error(`Routed mailbox not found: ${routing.mailboxId}`);
    working = { ...working, mailbox: swapped };
  }

  const slot = await reserveSendSlotInTx(
    tx,
    working.mailbox.id,
    working.enrollmentId,
    working.organizationId,
    at,
    working.settings,
    {
      recipientEmail: working.prospect.email,
      recipientGateway: working.prospect.emailGateway,
    },
  );

  if (!slot.ok) {
    const scheduled = await scheduleAt(tx, working, slot.deferUntil);
    await enqueueSequenceStepAt(
      { enrollmentId: working.enrollmentId, attempt: 0 },
      slot.deferUntil,
    );
    return scheduled;
  }

  const idempotencyKey = makeIdempotencyKey(working.enrollmentId, step.id, attempt);
  const existing = await tx.query.message.findFirst({
    where: and(
      eq(tables.message.idempotencyKey, idempotencyKey),
      eq(tables.message.organizationId, working.organizationId),
    ),
  });

  if (existing?.status === "sent") {
    await markReservationSentInTx(tx, slot.reservationId);
    const snapshot = toSnapshot(working);
    const result = transition(snapshot, {
      kind: "auto_sent",
      providerMessageId: existing.providerMessageId ?? "",
      at,
    });
    return applyTransitionEffects(tx, working, result.effects, attempt, result.nextState);
  }

  if (!working.anchorMessage?.messageIdHeader) {
    await releaseReservationInTx(tx, slot.reservationId);
    throw new Error("Cannot send auto email without anchor");
  }

  const config = step.config as EmailStepConfig;
  const templateCtx = {
    firstName: working.prospect.firstName,
    lastName: working.prospect.lastName,
    email: working.prospect.email,
    title: working.prospect.title,
    companyName: working.company?.name ?? null,
    companyDomain: working.company?.domain ?? null,
    senderFirstName: working.senderFirstName,
    senderSignature: working.senderSignature,
  };

  const subject = renderTemplate(config.subject, templateCtx);
  let bodyHtml = renderTemplate(config.body_template, templateCtx);
  let bodyText = stripHtml(bodyHtml);
  const signature = working.mailbox.signatureHtml ? `\n\n${working.mailbox.signatureHtml}` : "";

  const shouldSanitize =
    ctx.deliverabilityPolicy.contentSanitizerEnabled && isSegGateway(working.prospect.emailGateway);
  if (shouldSanitize) {
    const sanitized = sanitizeForSeg(
      { html: bodyHtml, text: bodyText },
      {
        stripTrackingPixel: true,
        stripExternalImages: true,
        preferPlainText: true,
      },
    );
    bodyHtml = sanitized.html;
    bodyText = sanitized.text;
  }

  const token = mintUnsubscribeToken({
    prospectId: working.prospect.id,
    orgId: working.organizationId,
  });
  const baseUrl = env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const senderPostalAddress = await getWorkspacePostalAddress(working.organizationId);
  const compliance = buildComplianceParts({
    unsubscribeUrl: buildUnsubscribeUrl(baseUrl, token),
    senderPostalAddress,
    senderOrgName: working.sequence.name,
  });

  const priorRefs = working.priorOutbound
    .map((m) => m.messageIdHeader)
    .filter((id): id is string => Boolean(id));

  const threading = buildThreadingHeaders({
    messageId: working.anchorMessage.messageIdHeader,
    subject: working.anchorMessage.subject ?? subject,
    providerThreadId: working.enrollment.anchorThreadId,
    priorReferences: priorRefs,
  });

  const adapter = createMailboxAdapter(working.mailbox, working.organizationId);

  try {
    await tx.insert(tables.message).values({
      organizationId: working.organizationId,
      mailboxId: working.mailbox.id,
      prospectId: working.prospect.id,
      enrollmentId: working.enrollmentId,
      direction: "outbound",
      subject,
      bodyHtml,
      bodyText,
      messageIdHeader: null,
      providerMessageId: null,
      providerThreadId: working.enrollment.anchorThreadId,
      inReplyTo: normalizeMessageId(working.anchorMessage.messageIdHeader),
      referencesHeader: [
        ...priorRefs.map(normalizeMessageId),
        normalizeMessageId(working.anchorMessage.messageIdHeader),
      ].join(" "),
      status: "sending",
      idempotencyKey,
    });

    const sendResult = await adapter.send({
      from: { email: working.mailbox.address, name: working.mailbox.fromName ?? undefined },
      to: [
        {
          email: working.prospect.email,
          name:
            [working.prospect.firstName, working.prospect.lastName].filter(Boolean).join(" ") ||
            undefined,
        },
      ],
      subject: threading.subject,
      html: `${bodyHtml}${signature}${compliance.footerHtml}`,
      text: `${bodyText}${signature ? `\n\n${stripHtml(signature)}` : ""}${compliance.footerText}`,
      threading,
      idempotencyKey,
    });

    if (process.env.QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK === "1") {
      throw new Error("Forced outer rollback after adapter.send (load test)");
    }

    const messageIdHeader = normalizeMessageId(sendResult.messageId);

    await tx
      .update(tables.message)
      .set({
        messageIdHeader,
        providerMessageId: sendResult.providerMessageId,
        providerThreadId: sendResult.providerThreadId ?? working.enrollment.anchorThreadId,
        status: "sent",
        sentAt: sendResult.sentAt,
      })
      .where(
        and(
          eq(tables.message.idempotencyKey, idempotencyKey),
          eq(tables.message.organizationId, working.organizationId),
        ),
      );

    await markReservationSentInTx(tx, slot.reservationId);

    const snapshot = toSnapshot(working);
    const result = transition(snapshot, {
      kind: "auto_sent",
      providerMessageId: sendResult.providerMessageId,
      at: sendResult.sentAt,
    });
    return applyTransitionEffects(tx, working, result.effects, attempt, result.nextState);
  } catch (err) {
    await releaseReservationInTx(tx, slot.reservationId);
    await tx
      .update(tables.message)
      .set({ status: "failed" })
      .where(
        and(
          eq(tables.message.idempotencyKey, idempotencyKey),
          eq(tables.message.organizationId, working.organizationId),
        ),
      );
    throw err;
  }
}

export async function logJobStart(
  jobName: string,
  payloadRef: string,
  attempt: number,
): Promise<void> {
  await db.insert(tables.jobLog).values({
    jobName,
    payloadRef,
    status: "started",
    attempt,
  });
}

export async function logJobSuccess(
  jobName: string,
  payloadRef: string,
  attempt: number,
  durationMs: number,
): Promise<void> {
  await db.insert(tables.jobLog).values({
    jobName,
    payloadRef,
    status: "succeeded",
    attempt,
    durationMs,
  });
}

export async function logJobFailure(
  jobName: string,
  payloadRef: string,
  attempt: number,
  error: string,
  dead: boolean,
): Promise<void> {
  await db.insert(tables.jobLog).values({
    jobName,
    payloadRef,
    status: dead ? "dead" : "failed",
    attempt,
    error,
  });
}

export interface StepFailureOptions {
  readonly forceTerminal: boolean;
  readonly retryLimit: number;
}

export async function handleStepFailure(
  ctx: EnrollmentContext,
  retryCount: number,
  err: unknown,
  options: StepFailureOptions,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);

  await db
    .update(tables.enrollment)
    .set({ lastError: message })
    .where(
      and(
        eq(tables.enrollment.id, ctx.enrollmentId),
        eq(tables.enrollment.organizationId, ctx.organizationId),
      ),
    );

  const maxAttempts = options.forceTerminal ? ctx.enrollment.attemptCount + 1 : MAX_STEP_ATTEMPTS;

  const retryAt =
    !options.forceTerminal && retryCount < options.retryLimit
      ? backoffUntil(retryCount)
      : undefined;

  const snapshot = toSnapshot(ctx);
  const result = transition(snapshot, {
    kind: "step_failed",
    error: message,
    at: new Date(),
    maxAttempts,
    retryAt,
  });

  await db.transaction(async (tx) => {
    await applyTransitionEffects(tx, ctx, result.effects, 0, result.nextState);
  });
}

export { MAX_STEP_ATTEMPTS };
