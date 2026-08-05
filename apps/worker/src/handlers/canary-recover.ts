import { env, logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import type { EmailGateway } from "@quiksend/mail";
import { buildMime, createSmtpTransport, sendMime } from "@quiksend/mail";
import { getBoss, registerHandler } from "@quiksend/queue";
import { and, eq, inArray, sql } from "drizzle-orm";
import { loadPauseContext, type PauseGroupKey } from "../deliverability/auto-pause-batch-loader.ts";

export interface AutoPauseDetails {
  gateway: EmailGateway;
  mailboxId: string;
  deliverabilityPct: number;
  threshold: number;
  delivered: number;
  total: number;
}

export async function registerCanaryRecoverHandler(): Promise<void> {
  await registerHandler("canary.recover", async () => {
    await maybeRecoverCampaigns();
  });
  const boss = await getBoss();
  await boss.schedule("canary.recover", "*/5 * * * *", {}, { tz: "UTC" });
  logger.info({ job: "canary.recover" }, "canary recover scheduled");
}

export async function maybeRecoverCampaigns(): Promise<void> {
  const stats = await db.execute<{
    sequence_id: string;
    mailbox_id: string;
    gateway: EmailGateway;
    organization_id: string;
    delivered: string;
    total: string;
  }>(sql`
    SELECT
      cs.sequence_id,
      cs.mailbox_id,
      si.gateway,
      cs.organization_id,
      count(*) FILTER (WHERE cs.arrival_status = 'arrived_inbox') AS delivered,
      count(*) AS total
    FROM canary_send cs
    JOIN seed_inbox si ON si.id = cs.seed_inbox_id
    JOIN mailbox mb ON mb.id = cs.mailbox_id
    WHERE cs.sent_at > now() - interval '2 hours'
      AND cs.arrival_status <> 'pending'
      AND mb.enterprise_safe_auto_downgraded = true
      AND mb.enterprise_safe_reason = 'auto_downgraded'
    GROUP BY cs.sequence_id, cs.mailbox_id, si.gateway, cs.organization_id
    HAVING count(*) >= 3
  `);

  if (stats.length === 0) return;

  const groups: PauseGroupKey[] = stats.map((row) => ({
    sequenceId: row.sequence_id,
    mailboxId: row.mailbox_id,
    gateway: row.gateway,
    organizationId: row.organization_id,
  }));
  const pauseContext = await loadPauseContext(groups);

  for (const row of stats) {
    const delivered = Number(row.delivered);
    const total = Number(row.total);
    const contextKey = `${row.organization_id}:${row.sequence_id}:${row.mailbox_id}:${row.gateway}`;
    const context = pauseContext.get(contextKey);
    if (!context) continue;

    const threshold = context.threshold;
    const deliverabilityPct = Math.round((delivered / total) * 100);
    if (deliverabilityPct < threshold) continue;

    await recoverSequenceCampaign(row.organization_id, row.sequence_id, {
      gateway: row.gateway,
      mailboxId: row.mailbox_id,
      deliverabilityPct,
      threshold,
      delivered,
      total,
    });
  }
}

/**
 * Canary auto-pause bulk-updates enrollments without per-row pause events. Manual
 * pauses and no_safe_mailbox pauses emit enrollment-level events, so only resume
 * paused rows whose latest pause signal is not user- or gateway-initiated.
 */
async function resumeCanaryAutoPausedEnrollments(
  organizationId: string,
  sequenceId: string,
  mailboxId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE enrollment e
    SET state = 'active', next_run_at = now()
    WHERE e.organization_id = ${organizationId}
      AND e.sequence_id = ${sequenceId}
      AND e.mailbox_id = ${mailboxId}
      AND e.state = 'paused'
      AND NOT EXISTS (
        SELECT 1
        FROM event ev
        WHERE ev.organization_id = e.organization_id
          AND ev.entity_type = 'enrollment'
          AND ev.entity_id = e.id
          AND ev.type IN ('enrollment.paused', 'enrollment.no_safe_mailbox_for_gateway')
          AND ev.created_at > COALESCE(
            (
              SELECT MAX(ev2.created_at)
              FROM event ev2
              WHERE ev2.organization_id = e.organization_id
                AND ev2.entity_type = 'enrollment'
                AND ev2.entity_id = e.id
                AND ev2.type = 'enrollment.resumed'
            ),
            'epoch'::timestamptz
          )
      )
  `);
}

async function recoverSequenceCampaign(
  organizationId: string,
  sequenceId: string,
  details: AutoPauseDetails,
): Promise<void> {
  const mailbox = await db.query.mailbox.findFirst({
    where: and(
      eq(tables.mailbox.id, details.mailboxId),
      eq(tables.mailbox.organizationId, organizationId),
      eq(tables.mailbox.enterpriseSafeAutoDowngraded, true),
      eq(tables.mailbox.enterpriseSafeReason, "auto_downgraded"),
    ),
  });
  if (!mailbox) return;

  await db
    .update(tables.mailbox)
    .set({
      enterpriseSafeAutoDowngraded: false,
      enterpriseSafeReason: null,
    })
    .where(
      and(
        eq(tables.mailbox.id, details.mailboxId),
        eq(tables.mailbox.organizationId, organizationId),
        eq(tables.mailbox.enterpriseSafeAutoDowngraded, true),
        eq(tables.mailbox.enterpriseSafeReason, "auto_downgraded"),
      ),
    );

  await resumeCanaryAutoPausedEnrollments(organizationId, sequenceId, details.mailboxId);

  await db.insert(tables.event).values({
    organizationId,
    type: "canary.deliverability_recovered",
    entityType: "sequence",
    entityId: sequenceId,
    payload: details,
  });

  await notifyAdminsOfAutoRecover(organizationId, sequenceId, details);
  logger.info({ organizationId, sequenceId, ...details }, "sequence auto-recovered by canary");
}

async function notifyAdminsOfAutoRecover(
  organizationId: string,
  sequenceId: string,
  details: AutoPauseDetails,
): Promise<void> {
  const [sequence, admins] = await Promise.all([
    db.query.sequence.findFirst({ where: eq(tables.sequence.id, sequenceId) }),
    db.query.member.findMany({
      where: and(
        eq(tables.member.organizationId, organizationId),
        inArray(tables.member.role, ["owner", "admin"]),
      ),
      with: { user: true },
    }),
  ]);
  if (!sequence || admins.length === 0 || !env.SMTP_HOST) return;

  const baseUrl = env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const reviewUrl = `${baseUrl}/deliverability`;
  const subject = `Campaign resumed: ${sequence.name}`;
  const text = [
    `Your campaign "${sequence.name}" has been automatically resumed.`,
    `Reason: deliverability to ${details.gateway} recovered to ${details.deliverabilityPct}% (threshold: ${details.threshold}%).`,
    `Details: ${details.total} canary sends in the last 2 hours, ${details.delivered} arrived inbox.`,
    `Review: ${reviewUrl}`,
  ].join("\n");

  const transport = createSmtpTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 1025,
    secure: false,
  });

  for (const admin of admins) {
    const email = admin.user?.email;
    if (!email) continue;
    const mime = buildMime({
      from: { email: "alerts@quiksend.local", name: "Quiksend Deliverability" },
      to: [{ email }],
      subject,
      html: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
      text,
      compliance: {
        unsubscribeUrl: reviewUrl,
        senderPostalAddress: "Quiksend Systems",
        senderOrgName: "Quiksend",
      },
    });
    await sendMime(transport, mime).catch((err) => {
      logger.error({ err, email }, "failed to send auto-recover notification");
    });
  }
}
