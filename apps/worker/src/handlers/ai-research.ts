import { buildProfile } from "@quiksend/ai";
import { logger } from "@quiksend/config";
import { registerHandler } from "@quiksend/queue";

export async function registerAiResearchHandler(): Promise<void> {
  await registerHandler("ai.research", async ({ prospectId, forceRefresh }) => {
    logger.info({ prospectId, forceRefresh }, "ai.research started");
    await buildProfile(prospectId, { forceRefresh });
    logger.info({ prospectId }, "ai.research completed");
  });
}
