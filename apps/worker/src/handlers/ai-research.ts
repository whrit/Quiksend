import { buildProfile } from "@quiksend/ai";
import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { registerHandler } from "@quiksend/queue";
import { eq } from "drizzle-orm";

export async function registerAiResearchHandler(): Promise<void> {
  await registerHandler("ai.research", async ({ prospectId, forceRefresh }) => {
    // Verify prospect exists and derive org for audit context
    const prospect = await db.query.prospect.findFirst({
      columns: { id: true, organizationId: true },
      where: eq(tables.prospect.id, prospectId),
    });
    if (!prospect) {
      logger.warn({ prospectId }, "ai.research: prospect not found, skipping");
      return;
    }
    logger.info({ prospectId, organizationId: prospect.organizationId, forceRefresh }, "ai.research started");
    await buildProfile(prospectId, { forceRefresh });
    logger.info({ prospectId, organizationId: prospect.organizationId }, "ai.research completed");
  });
}
