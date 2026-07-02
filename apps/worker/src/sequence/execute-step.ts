import { transition } from "@quiksend/core/state-machine";
import { db } from "@quiksend/db";
import { Sentry } from "@quiksend/observability";
import type { SequenceStepPayload } from "@quiksend/queue";
import { toSnapshot, currentStep } from "./context.ts";
import {
  applyTransitionEffects,
  handleStepFailure,
  logJobFailure,
  logJobStart,
  logJobSuccess,
  MAX_STEP_ATTEMPTS,
} from "./effects.ts";
import { hasReplyOnThread, isSuppressed } from "./guards.ts";
import { makePayloadRef } from "./idempotency.ts";
import { loadContext } from "./load-context.ts";

export async function executeStep({ enrollmentId, attempt }: SequenceStepPayload): Promise<void> {
  const ctx = await loadContext(enrollmentId);
  const step = currentStep(ctx);
  const payloadRef = makePayloadRef(ctx.enrollmentId, step?.id ?? null, attempt);
  const started = Date.now();

  await logJobStart("sequence.step", payloadRef, attempt);

  try {
    if (isSuppressed(ctx)) {
      await db.transaction(async (tx) => {
        await applyTransitionEffects(
          tx,
          ctx,
          [{ kind: "terminate", reason: "stopped" }],
          attempt,
          "stopped",
        );
      });
      await logJobSuccess("sequence.step", payloadRef, attempt, Date.now() - started);
      return;
    }

    if (ctx.stopOnReply && (await hasReplyOnThread(ctx))) {
      await db.transaction(async (tx) => {
        await applyTransitionEffects(
          tx,
          ctx,
          [
            { kind: "terminate", reason: "replied" },
            { kind: "emit_event", type: "enrollment.replied" },
          ],
          attempt,
          "replied",
        );
      });
      await logJobSuccess("sequence.step", payloadRef, attempt, Date.now() - started);
      return;
    }

    const snapshot = toSnapshot(ctx);
    const { nextState, effects } = transition(snapshot, { kind: "tick", at: new Date() });

    await db.transaction(async (tx) => {
      await applyTransitionEffects(tx, ctx, effects, attempt, nextState);
    });

    await logJobSuccess("sequence.step", payloadRef, attempt, Date.now() - started);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isDead = attempt + 1 >= MAX_STEP_ATTEMPTS;
    await logJobFailure("sequence.step", payloadRef, attempt, message, isDead);

    if (isDead) {
      Sentry.captureException(err, {
        extra: { enrollmentId, attempt, organizationId: ctx.organizationId },
      });
      await handleStepFailure(ctx, attempt, err);
    }

    throw err;
  }
}
