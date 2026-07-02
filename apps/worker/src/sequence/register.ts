import { logger } from "@quiksend/config";
import { getBoss } from "@quiksend/queue";
import { sequenceStepSchema } from "@quiksend/queue";
import { Sentry } from "@quiksend/observability";
import { executeStep } from "./execute-step.ts";
import { tick } from "./tick.ts";

export async function registerSequenceHandlers(): Promise<void> {
  const boss = await getBoss();

  await boss.createQueue("sequence.tick");
  await boss.schedule("sequence.tick", "*/30 * * * * *", {}, { tz: "UTC" });
  await boss.work("sequence.tick", async (jobs) => {
    for (const job of jobs) {
      void job;
      await tick();
    }
  });
  logger.info({ job: "sequence.tick" }, "job handler registered");

  await boss.createQueue("sequence.step");
  await boss.work("sequence.step", { includeMetadata: true }, async (jobs) => {
    for (const item of jobs) {
      const payload = sequenceStepSchema.parse(item.data);
      try {
        await executeStep(payload);
      } catch (err) {
        const isDead = item.retryCount >= item.retryLimit;
        if (isDead) {
          Sentry.captureException(err, {
            extra: { jobId: item.id, enrollmentId: payload.enrollmentId },
          });
        }
        throw err;
      }
    }
  });
  logger.info({ job: "sequence.step" }, "job handler registered");
}
