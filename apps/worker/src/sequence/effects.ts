import {
  transition,
  type Effect,
  type EnrollmentState,
  type Event,
} from "@quiksend/core/state-machine";
import { logger } from "@quiksend/config";
import { isSegGateway } from "@quiksend/core/deliverability";
import { emailDomain } from "@quiksend/core";
import { env } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import {
  buildUnsubscribeUrl,
  mintUnsubscribeToken,
  resolvePostalAddress,
  sanitizeForSeg,
} from "@quiksend/mail";
import { buildThreadingHeaders, normalizeMessageId } from "@quiksend/mail/threading";
import type { ComplianceInput, OutboundEmail } from "@quiksend/mail";
import { and, eq, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@quiksend/db/schema";
import { backoffUntil } from "./backoff.ts";
import {
  computeNextRunAt,
  effectiveStepConfig,
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
import { checkSendPreConditions } from "./guards.ts";
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
  if (!step) {
    logger.error(
      {
        organizationId: ctx.organizationId,
        enrollmentId: ctx.enrollmentId,
        stepIndex,
        taskType: "compose",
      },
      "sequence step not found for task creation",
    );
    throw new Error(
      `Sequence step ${stepIndex} not found for compose task (enrollment ${ctx.enrollmentId})`,
    );
  }
  const config = effectiveStepConfig(ctx, step) as EmailStepConfig;
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
  if (!step) {
    logger.error(
      {
        organizationId: ctx.organizationId,
        enrollmentId: ctx.enrollmentId,
        stepIndex,
        taskType: "generic",
      },
      "sequence step not found for task creation",
    );
    throw new Error(
      `Sequence step ${stepIndex} not found for generic task (enrollment ${ctx.enrollmentId})`,
    );
  }
  const config = effectiveStepConfig(ctx, step) as TaskStepConfig;
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
  _tx: DbTx,
  ctx: EnrollmentContext,
  stepIndex: number,
  attempt: number,
): Promise<EnrollmentContext> {
  const step = ctx.steps.find((s) => s.stepIndex === stepIndex);
  if (!step || step.stepType !== "auto_email") return ctx;

  const at = new Date();

  const prep = await db.transaction(async (tx) => {
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
      const updated = await applyTransitionEffects(
        tx,
        working,
        result.effects,
        attempt,
        result.nextState,
      );
      return { kind: "done" as const, ctx: updated };
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
      return { kind: "done" as const, ctx: scheduled };
    }

    const idempotencyKey = makeIdempotencyKey(working.enrollmentId, step.id, attempt);
    const existing = await tx.query.message.findFirst({
      where: and(
        eq(tables.message.idempotencyKey, idempotencyKey),
        eq(tables.message.organizationId, working.organizationId),
      ),
    });

    if (existing?.status === "sent") {
      await releaseReservationInTx(tx, slot.reservationId);
      const snapshot = toSnapshot(working);
      const result = transition(snapshot, {
        kind: "auto_sent",
        providerMessageId: existing.providerMessageId ?? existing.messageIdHeader ?? idempotencyKey,
        at,
      });
      const updated = await applyTransitionEffects(
        tx,
        working,
        result.effects,
        attempt,
        result.nextState,
      );
      return { kind: "done" as const, ctx: updated };
    }

    const guard = await recheckSendAllowedInTx(tx, working);
    if (!guard.ok) {
      await releaseReservationInTx(tx, slot.reservationId);
      const updated = await handleSendGuardInTx(tx, working, guard, {
        phase: "pre_send",
        at,
        attempt,
      });
      return { kind: "done" as const, ctx: updated };
    }

    if (!working.anchorMessage?.messageIdHeader) {
      await releaseReservationInTx(tx, slot.reservationId);
      throw new Error("Cannot send auto email without anchor");
    }

    const config = effectiveStepConfig(working, step) as EmailStepConfig;
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
      ctx.deliverabilityPolicy.contentSanitizerEnabled &&
      isSegGateway(working.prospect.emailGateway);
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
    const compliance: ComplianceInput = {
      unsubscribeUrl: buildUnsubscribeUrl(baseUrl, token),
      senderPostalAddress,
      senderOrgName: working.sequence.name,
    };

    const priorRefs = working.priorOutbound
      .map((m) => m.messageIdHeader)
      .filter((id): id is string => Boolean(id));

    const threading = buildThreadingHeaders({
      messageId: working.anchorMessage.messageIdHeader,
      subject: working.anchorMessage.subject ?? subject,
      providerThreadId: working.enrollment.anchorThreadId,
      priorReferences: priorRefs,
    });

    const sendInput: OutboundEmail = {
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
      html: `${bodyHtml}${signature}`,
      text: `${bodyText}${signature ? `\n\n${stripHtml(signature)}` : ""}`,
      threading,
      idempotencyKey,
    };

    if (!existing) {
      await tx.insert(tables.message).values({
        organizationId: working.organizationId,
        mailboxId: working.mailbox.id,
        prospectId: working.prospect.id,
        enrollmentId: working.enrollmentId,
        // Captured now: the enrollment advances past this step immediately after,
        // so it cannot be recovered from enrollment.currentStepIndex later.
        sequenceStepIndex: stepIndex,
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
    }

    return {
      kind: "ready" as const,
      working,
      slot,
      idempotencyKey,
      compliance,
      sendInput,
      attempt,
    };
  });

  if (prep.kind === "done") return prep.ctx;

  const adapter = createMailboxAdapter(
    prep.working.mailbox,
    prep.working.organizationId,
    prep.compliance,
  );

  try {
    const sendResult = await adapter.send(prep.sendInput);

    if (env.QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK) {
      throw new Error("Forced outer rollback after adapter.send (load test)");
    }

    return await db.transaction(async (tx) => {
      const guard = await recheckSendAllowedInTx(tx, prep.working);
      const messageIdHeader = normalizeMessageId(sendResult.messageId);
      const now = new Date();

      await tx
        .update(tables.message)
        .set({
          messageIdHeader,
          providerMessageId: sendResult.providerMessageId,
          providerThreadId: sendResult.providerThreadId ?? prep.working.enrollment.anchorThreadId,
          status: "sent",
          acceptedAt: now,
          sentAt: sendResult.sentAt,
          metadataReconciledAt: sendResult.metadataReconciled ? now : null,
          reconciliationError: sendResult.metadataReconciled
            ? null
            : "metadata lookup failed post-acceptance",
        })
        .where(
          and(
            eq(tables.message.idempotencyKey, prep.idempotencyKey),
            eq(tables.message.organizationId, prep.working.organizationId),
          ),
        );

      await markReservationSentInTx(tx, prep.slot.reservationId);

      if (!guard.ok) {
        return handleSendGuardInTx(tx, prep.working, guard, {
          phase: "post_send",
          at: sendResult.sentAt,
          attempt: prep.attempt,
          providerMessageId: sendResult.providerMessageId ?? messageIdHeader,
        });
      }

      const snapshot = toSnapshot(prep.working);
      const result = transition(snapshot, {
        kind: "auto_sent",
        providerMessageId: sendResult.providerMessageId ?? messageIdHeader,
        at: sendResult.sentAt,
      });
      return applyTransitionEffects(
        tx,
        prep.working,
        result.effects,
        prep.attempt,
        result.nextState,
      );
    });
  } catch (err) {
    await db.transaction(async (tx) => {
      await releaseReservationInTx(tx, prep.slot.reservationId);
      await tx
        .update(tables.message)
        .set({ status: "failed" })
        .where(
          and(
            eq(tables.message.idempotencyKey, prep.idempotencyKey),
            eq(tables.message.organizationId, prep.working.organizationId),
          ),
        );
    });
    throw err;
  }
}

async function isSuppressionListedInTx(
  tx: DbTx,
  organizationId: string,
  email: string,
): Promise<boolean> {
  const normalized = email.toLowerCase();
  const domain = emailDomain(normalized);

  const rows = await tx
    .select({ id: tables.suppression.id })
    .from(tables.suppression)
    .where(
      and(
        eq(tables.suppression.organizationId, organizationId),
        or(
          and(eq(tables.suppression.valueType, "email"), eq(tables.suppression.value, normalized)),
          and(eq(tables.suppression.valueType, "domain"), eq(tables.suppression.value, domain)),
        ),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

async function hasReplyOnThreadInTx(tx: DbTx, ctx: EnrollmentContext): Promise<boolean> {
  if (!ctx.enrollment.anchorThreadId && !ctx.enrollment.anchorMessageId) return false;

  const conditions = [eq(tables.message.organizationId, ctx.organizationId)];
  const threadId = ctx.enrollment.anchorThreadId;
  const anchorId = ctx.enrollment.anchorMessageId;

  if (threadId) {
    const rows = await tx
      .select({ id: tables.message.id })
      .from(tables.message)
      .where(
        and(
          ...conditions,
          eq(tables.message.direction, "inbound"),
          eq(tables.message.isAutoReply, false),
          eq(tables.message.providerThreadId, threadId),
        ),
      )
      .limit(1);
    if (rows.length > 0) return true;
  }

  if (anchorId) {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from message
      where organization_id = ${ctx.organizationId}
        and direction = 'inbound'
        and is_auto_reply = false
        and (
          in_reply_to = ${anchorId}
          or references_header ilike ${`%${anchorId}%`}
        )
      limit 1
    `);
    if (rows.length > 0) return true;
  }

  return false;
}

function sendGuardEvent(
  ctx: EnrollmentContext,
  reason: string,
  at: Date,
  phase: "pre_send" | "post_send",
  providerMessageId?: string,
): Event | null {
  switch (reason) {
    case "suppressed":
      return { kind: "suppressed", at };
    case "reply_received":
      return { kind: "reply_received", at, stopOnReply: ctx.stopOnReply };
    case "mailbox_archived":
    case "prospect_deleted":
    case "missing_postal_address":
      return { kind: "stop", reason };
    case "enrollment_not_active":
      if (phase === "post_send" && providerMessageId) {
        return { kind: "auto_sent", providerMessageId, at };
      }
      return null;
    case "enrollment_missing":
      throw new Error(`Enrollment not found during send guard: ${ctx.enrollmentId}`);
    default:
      throw new Error(`Unknown send guard reason: ${reason}`);
  }
}

async function reloadEnrollmentInTx(tx: DbTx, ctx: EnrollmentContext): Promise<EnrollmentContext> {
  const enrollment = await tx.query.enrollment.findFirst({
    where: and(
      eq(tables.enrollment.id, ctx.enrollmentId),
      eq(tables.enrollment.organizationId, ctx.organizationId),
    ),
  });
  if (!enrollment) {
    throw new Error(`Enrollment not found during send guard: ${ctx.enrollmentId}`);
  }
  return { ...ctx, enrollment };
}

async function handleSendGuardInTx(
  tx: DbTx,
  ctx: EnrollmentContext,
  guard: { ok: false; reason: string },
  options: {
    phase: "pre_send" | "post_send";
    at: Date;
    attempt: number;
    providerMessageId?: string;
  },
): Promise<EnrollmentContext> {
  logger.warn(
    {
      organizationId: ctx.organizationId,
      enrollmentId: ctx.enrollmentId,
      reason: guard.reason,
      phase: options.phase,
    },
    "send guard blocked",
  );

  const event = sendGuardEvent(
    ctx,
    guard.reason,
    options.at,
    options.phase,
    options.providerMessageId,
  );
  if (!event) {
    return reloadEnrollmentInTx(tx, ctx);
  }

  if (options.phase === "post_send" && event.kind !== "auto_sent") {
    await handleEmitEvent(tx, ctx, "message.sent");
  }

  const snapshot = toSnapshot(ctx);
  const result = transition(snapshot, event);
  return applyTransitionEffects(tx, ctx, result.effects, options.attempt, result.nextState);
}

async function recheckSendAllowedInTx(
  tx: DbTx,
  ctx: EnrollmentContext,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const enrollment = await tx.query.enrollment.findFirst({
    where: and(
      eq(tables.enrollment.id, ctx.enrollmentId),
      eq(tables.enrollment.organizationId, ctx.organizationId),
    ),
  });
  if (!enrollment) return { ok: false, reason: "enrollment_missing" };
  if (enrollment.state !== "active") return { ok: false, reason: "enrollment_not_active" };

  const [mailbox, prospect] = await Promise.all([
    tx.query.mailbox.findFirst({
      where: and(
        eq(tables.mailbox.id, ctx.mailbox.id),
        eq(tables.mailbox.organizationId, ctx.organizationId),
      ),
      columns: { status: true },
    }),
    tx.query.prospect.findFirst({
      where: and(
        eq(tables.prospect.id, ctx.prospect.id),
        eq(tables.prospect.organizationId, ctx.organizationId),
      ),
      columns: { deletedAt: true },
    }),
  ]);
  if (!mailbox) return { ok: false, reason: "mailbox_archived" };
  if (!prospect) return { ok: false, reason: "prospect_deleted" };

  const sync = checkSendPreConditions({
    mailboxStatus: mailbox.status,
    prospectStatus: ctx.prospect.status,
    prospectDeletedAt: prospect.deletedAt,
    enrollmentState: null, // stricter active-only check handled above
  });
  if (!sync.ok) return sync;

  // Fail-closed: missing CAN-SPAM postal address
  const org = await tx.query.organization.findFirst({
    where: eq(tables.organization.id, ctx.organizationId),
    columns: { metadata: true },
  });
  try {
    resolvePostalAddress({
      organizationId: ctx.organizationId,
      metadata: (org?.metadata as string) ?? null,
    });
  } catch {
    return { ok: false, reason: "missing_postal_address" };
  }

  if (await isSuppressionListedInTx(tx, ctx.organizationId, ctx.prospect.email)) {
    return { ok: false, reason: "suppressed" };
  }

  if (ctx.stopOnReply && (await hasReplyOnThreadInTx(tx, ctx))) {
    return { ok: false, reason: "reply_received" };
  }

  return { ok: true };
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
