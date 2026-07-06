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
  // Order matters: `registerHandler` internally calls `boss.createQueue`, which
  // inserts the row into `pgboss.queue`. `boss.schedule` inserts into
  // `pgboss.schedule` with an FK back to `pgboss.queue.name` — scheduling
  // before the queue exists throws `Queue nango.webhook.sweep not found`.
  await registerHandler("nango.webhook.sweep", async () => {
    await sweepNangoWebhookProcessed();
  });
  const boss = await getBoss();
  await boss.schedule("nango.webhook.sweep", "0 * * * *", {}, { tz: "UTC" });
  logger.info({ job: "nango.webhook.sweep" }, "nango webhook sweep scheduled");
}
