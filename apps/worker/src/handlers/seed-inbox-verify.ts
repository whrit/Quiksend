import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { registerHandler } from "@quiksend/queue";
import { and, eq } from "drizzle-orm";
import { decryptSeedImapConfig, validateImapHost } from "@quiksend/mail";
import { verifyImapConnection } from "../deliverability/seed-imap.ts";

const MAX_VERIFY_ATTEMPTS = 3;

export async function registerSeedInboxVerifyHandler(): Promise<void> {
  await registerHandler("seed_inbox.verify", async ({ seedInboxId, organizationId }) => {
    // Fail closed: org scope is required for tenant seed inboxes.
    // System-pool seeds (organizationId=null) are verified by seed_pool.health_check instead.
    if (!organizationId) {
      logger.warn({ seedInboxId }, "seed_inbox.verify: missing organizationId, skipping");
      return;
    }

    const seed = await db.query.seedInbox.findFirst({
      where: and(
        eq(tables.seedInbox.id, seedInboxId),
        eq(tables.seedInbox.organizationId, organizationId),
      ),
    });
    if (!seed) {
      logger.warn({ seedInboxId, organizationId }, "seed_inbox.verify: seed not found or org mismatch");
      return;
    }

    try {
      const config = decryptSeedImapConfig(seed.imapConfig, seed.organizationId);
      const hostError = validateImapHost(config.host);
      if (hostError) {
        logger.warn({ seedInboxId, host: config.host }, `security: ${hostError}`);
        throw new Error(hostError);
      }
      await verifyImapConnection(config);
      await db
        .update(tables.seedInbox)
        .set({ verifiedAt: new Date(), active: true })
        .where(and(eq(tables.seedInbox.id, seedInboxId), eq(tables.seedInbox.organizationId, organizationId)));
      logger.info({ seedInboxId, organizationId }, "seed_inbox.verify succeeded");
    } catch (err) {
      logger.error({ err, seedInboxId, organizationId }, "seed_inbox.verify failed");
      await db
        .update(tables.seedInbox)
        .set({ active: false })
        .where(and(eq(tables.seedInbox.id, seedInboxId), eq(tables.seedInbox.organizationId, organizationId)));
      throw err;
    }
  });
}

export { MAX_VERIFY_ATTEMPTS };
