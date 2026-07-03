import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { getBoss } from "@quiksend/queue";
import { sql } from "drizzle-orm";

export type SnapshotWindowDays = 7 | 14 | 30;

const SNAPSHOT_WINDOWS: SnapshotWindowDays[] = [7, 14, 30];

export async function registerDeliverabilitySnapshotHandler(): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue("deliverability.snapshot");
  await boss.schedule("deliverability.snapshot", "*/15 * * * *", {}, { tz: "UTC" });
  await boss.work("deliverability.snapshot", async () => {
    await refreshDeliverabilitySnapshots();
  });
  logger.info({ job: "deliverability.snapshot" }, "deliverability snapshot scheduled");
}

export async function refreshDeliverabilitySnapshots(): Promise<void> {
  await Promise.all(
    SNAPSHOT_WINDOWS.map((windowDays) => refreshDeliverabilitySnapshot(windowDays)),
  );
}

export async function refreshDeliverabilitySnapshot(windowDays: SnapshotWindowDays): Promise<void> {
  await db.execute(sql`
    INSERT INTO deliverability_snapshot (
      organization_id,
      mailbox_id,
      gateway,
      window_days,
      window_start,
      window_end,
      canary_total,
      canary_delivered,
      canary_spam,
      canary_quarantine,
      canary_silent_dropped,
      deliverability_pct
    )
    SELECT
      cs.organization_id,
      cs.mailbox_id,
      si.gateway,
      ${windowDays},
      date_trunc('day', now() - make_interval(days => ${windowDays})),
      now(),
      count(*)::int AS canary_total,
      count(*) FILTER (WHERE cs.arrival_status = 'arrived_inbox')::int AS canary_delivered,
      count(*) FILTER (WHERE cs.arrival_status = 'arrived_spam')::int AS canary_spam,
      count(*) FILTER (WHERE cs.arrival_status = 'arrived_quarantine')::int AS canary_quarantine,
      count(*) FILTER (WHERE cs.arrival_status IN ('silent_drop', 'bounced'))::int AS canary_silent_dropped,
      round(
        100.0 * count(*) FILTER (WHERE cs.arrival_status = 'arrived_inbox') / nullif(count(*), 0),
        2
      ) AS deliverability_pct
    FROM canary_send cs
    JOIN seed_inbox si ON si.id = cs.seed_inbox_id
    WHERE cs.sent_at >= date_trunc('day', now() - make_interval(days => ${windowDays}))
      AND cs.arrival_status <> 'pending'
    GROUP BY cs.organization_id, cs.mailbox_id, si.gateway
    ON CONFLICT (organization_id, mailbox_id, gateway, window_days, window_start)
    DO UPDATE SET
      window_end = EXCLUDED.window_end,
      canary_total = EXCLUDED.canary_total,
      canary_delivered = EXCLUDED.canary_delivered,
      canary_spam = EXCLUDED.canary_spam,
      canary_quarantine = EXCLUDED.canary_quarantine,
      canary_silent_dropped = EXCLUDED.canary_silent_dropped,
      deliverability_pct = EXCLUDED.deliverability_pct,
      created_at = now()
  `);
}
