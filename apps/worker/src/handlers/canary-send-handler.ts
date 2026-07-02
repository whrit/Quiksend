import { logger } from "@quiksend/config";
import { registerHandler } from "@quiksend/queue";
import { materializeCanarySend } from "../deliverability/canary-send.ts";

export async function registerCanarySendHandler(): Promise<void> {
  await registerHandler("canary.send", async ({ canarySendId }) => {
    try {
      await materializeCanarySend(canarySendId);
      logger.info({ canarySendId }, "canary.send completed");
    } catch (err) {
      logger.error({ err, canarySendId }, "canary.send failed");
      throw err;
    }
  });
}
