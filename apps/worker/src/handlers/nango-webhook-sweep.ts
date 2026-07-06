import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { getBoss, registerHandler } from "@quiksend/queue";
import { sql } from "drizzle-orm";

export async function sweepNangoWebhookProcessed(): Promise<void> {
  await db.execute(sql`
    DELETE FROM nango_webhook_processed
    WHERE processed_at < now() - interval '7 days'
  `);
}

export async function registerNangoWebhookSweep(): Promise<void> {
  const boss = await getBoss();
  await boss.schedule("nango.webhook.sweep", "0 * * * *", {}, { tz: "UTC" });
  await registerHandler("nango.webhook.sweep", async () => {
    await sweepNangoWebhookProcessed();
  });
  logger.info({ job: "nango.webhook.sweep" }, "nango webhook sweep scheduled");
}
