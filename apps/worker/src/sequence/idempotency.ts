import { createHash } from "node:crypto";
import type { SequenceStepPayload } from "@quiksend/queue";
import { getBoss } from "@quiksend/queue";
import { sequenceStepSchema } from "@quiksend/queue";

const STEP_RETRY_OPTIONS = {
  retryLimit: 4,
  retryDelay: 60,
  retryBackoff: true,
  retryDelayMax: 43_200,
} as const;

export function makePayloadRef(
  enrollmentId: string,
  stepId: string | null,
  attempt: number,
): string {
  return `${enrollmentId}|${stepId ?? "none"}|${attempt}`;
}

export function makeIdempotencyKey(enrollmentId: string, stepId: string, attempt: number): string {
  const raw = `${enrollmentId}|${stepId}|${attempt}`;
  return createHash("sha256").update(raw).digest("hex");
}

/** Enqueue a step job with pg-boss retry + singleton dedupe. */
export async function enqueueSequenceStep(payload: SequenceStepPayload): Promise<string | null> {
  const validated = sequenceStepSchema.parse(payload);
  const boss = await getBoss();
  return boss.send("sequence.step", validated, {
    ...STEP_RETRY_OPTIONS,
    singletonKey: `${validated.enrollmentId}:${validated.attempt}`,
  });
}

/** Defer a step to a future time (cap/window/throttle). */
export async function enqueueSequenceStepAt(
  payload: SequenceStepPayload,
  at: Date,
): Promise<string | null> {
  const validated = sequenceStepSchema.parse(payload);
  const boss = await getBoss();
  return boss.sendAfter("sequence.step", validated, STEP_RETRY_OPTIONS, at);
}
