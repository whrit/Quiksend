import { transition } from "@quiksend/core/state-machine";
import { db } from "@quiksend/db";
import { SendError } from "@quiksend/mail";
import { Sentry } from "@quiksend/observability";
import { toSnapshot, currentStep } from "./context.ts";
import {
  applyTransitionEffects,
  handleStepFailure,
  logJobFailure,
  logJobStart,
  logJobSuccess,
} from "./effects.ts";
import { hasReplyOnThread, isSuppressed } from "./guards.ts";
import { makePayloadRef } from "./idempotency.ts";
import { loadContext } from "./load-context.ts";

export interface ExecuteStepInput {
  readonly enrollmentId: string;
  /** pg-boss retryCount — NOT used for idempotency keys (those stay at step attempt 0). */
  readonly retryCount: number;
  readonly retryLimit: number;
}

export async function executeStep({
  enrollmentId,
  retryCount,
  retryLimit,
}: ExecuteStepInput): Promise<void> {
  const ctx = await loadContext(enrollmentId);
  const step = currentStep(ctx);
  const stepAttempt = 0;
  const payloadRef = makePayloadRef(ctx.enrollmentId, step?.id ?? null, retryCount);
  const started = Date.now();

  await logJobStart("sequence.step", payloadRef, retryCount);

  try {
    if (await isSuppressed(ctx)) {
      const snapshot = toSnapshot(ctx);
      const { nextState, effects } = transition(snapshot, {
        kind: "suppressed",
        at: new Date(),
      });
      await db.transaction(async (tx) => {
        await applyTransitionEffects(tx, ctx, effects, stepAttempt, nextState);
      });
      await logJobSuccess("sequence.step", payloadRef, retryCount, Date.now() - started);
      return;
    }

    if (ctx.stopOnReply && (await hasReplyOnThread(ctx))) {
      const snapshot = toSnapshot(ctx);
      const { nextState, effects } = transition(snapshot, {
        kind: "reply_received",
        at: new Date(),
        stopOnReply: true,
      });
      await db.transaction(async (tx) => {
        await applyTransitionEffects(tx, ctx, effects, stepAttempt, nextState);
      });
      await logJobSuccess("sequence.step", payloadRef, retryCount, Date.now() - started);
      return;
    }

    const snapshot = toSnapshot(ctx);
    const { nextState, effects } = transition(snapshot, { kind: "tick", at: new Date() });

    await db.transaction(async (tx) => {
      await applyTransitionEffects(tx, ctx, effects, stepAttempt, nextState);
    });

    await logJobSuccess("sequence.step", payloadRef, retryCount, Date.now() - started);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isPermanent =
      err instanceof SendError && (err.kind === "permanent" || err.kind === "auth");
    const isDead = isPermanent || retryCount >= retryLimit;

    await logJobFailure("sequence.step", payloadRef, retryCount, message, isDead);

    if (isDead) {
      Sentry.captureException(err, {
        extra: { enrollmentId, retryCount, organizationId: ctx.organizationId },
      });
      await handleStepFailure(ctx, retryCount, err, {
        forceTerminal: isPermanent,
        retryLimit,
      });
      return;
    }

    await handleStepFailure(ctx, retryCount, err, { forceTerminal: false, retryLimit });
    throw err;
  }
}
