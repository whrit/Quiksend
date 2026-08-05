import { buildProfile } from "@quiksend/ai";
import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { registerHandler } from "@quiksend/queue";
import { and, eq } from "drizzle-orm";

export async function registerAiResearchHandler(): Promise<void> {
  await registerHandler("ai.research", async ({ prospectId, organizationId, forceRefresh }) => {
    // Fail closed: org scope is required
    if (!organizationId) {
      logger.warn({ prospectId }, "ai.research: missing organizationId, skipping");
      return;
    }

    // Verify prospect belongs to the claimed org
    const prospect = await db.query.prospect.findFirst({
      columns: { id: true, organizationId: true },
      where: and(
        eq(tables.prospect.id, prospectId),
        eq(tables.prospect.organizationId, organizationId),
      ),
    });
    if (!prospect) {
      logger.warn({ prospectId, organizationId }, "ai.research: prospect not found or org mismatch, skipping");
      return;
    }

    logger.info({ prospectId, organizationId, forceRefresh }, "ai.research started");
    await buildProfile(prospectId, organizationId, { forceRefresh });
    logger.info({ prospectId, organizationId }, "ai.research completed");
  });
}
