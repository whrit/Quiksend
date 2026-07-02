import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { sql } from "drizzle-orm";

export async function sweepNangoWebhookProcessed(): Promise<void> {
  await db.execute(sql`
    DELETE FROM nango_webhook_processed
    WHERE processed_at < now() - interval '7 days'
  `);
}

export async function registerNangoWebhookSweep(): Promise<void> {
  const { getBoss } = await import("@quiksend/queue");
  const boss = await getBoss();
  await boss.createQueue("nango.webhook.sweep");
  await boss.schedule("nango.webhook.sweep", "0 * * * *", {}, { tz: "UTC" });
  await boss.work("nango.webhook.sweep", async () => {
    await sweepNangoWebhookProcessed();
  });
  logger.info({ job: "nango.webhook.sweep" }, "nango webhook sweep scheduled");
}
