import { logger } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import { registerHandler } from "@quiksend/queue";
import { eq } from "drizzle-orm";
import { decryptSeedImapConfig } from "@quiksend/mail";
import { verifyImapConnection } from "../deliverability/seed-imap.ts";

const MAX_VERIFY_ATTEMPTS = 3;

export async function registerSeedInboxVerifyHandler(): Promise<void> {
  await registerHandler("seed_inbox.verify", async ({ seedInboxId }) => {
    const seed = await db.query.seedInbox.findFirst({
      where: eq(tables.seedInbox.id, seedInboxId),
    });
    if (!seed) {
      logger.warn({ seedInboxId }, "seed_inbox.verify: seed not found");
      return;
    }

    try {
      const config = decryptSeedImapConfig(seed.imapConfig, seed.organizationId);
      await verifyImapConnection(config);
      await db
        .update(tables.seedInbox)
        .set({ verifiedAt: new Date(), active: true })
        .where(eq(tables.seedInbox.id, seedInboxId));
      logger.info({ seedInboxId }, "seed_inbox.verify succeeded");
    } catch (err) {
      logger.error({ err, seedInboxId }, "seed_inbox.verify failed");
      await db
        .update(tables.seedInbox)
        .set({ active: false })
        .where(eq(tables.seedInbox.id, seedInboxId));
      throw err;
    }
  });
}

export { MAX_VERIFY_ATTEMPTS };
