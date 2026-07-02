import { logger } from "@quiksend/config";
import { getBoss } from "@quiksend/queue";
import { sequenceStepSchema } from "@quiksend/queue";
import { executeStep } from "./execute-step.ts";
import { tick } from "./tick.ts";

export async function registerSequenceHandlers(): Promise<void> {
  const boss = await getBoss();

  await boss.createQueue("sequence.tick");
  // Every 10s (was 30s) — higher scheduler throughput under backlog (PERF-002).
  await boss.schedule("sequence.tick", "*/10 * * * * *", {}, { tz: "UTC" });
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
      await executeStep({
        enrollmentId: payload.enrollmentId,
        retryCount: item.retryCount,
        retryLimit: item.retryLimit,
      });
    }
  });
  logger.info({ job: "sequence.step" }, "job handler registered");
}
