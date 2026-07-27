import { evaluateAutoPause } from "@quiksend/core/deliverability";
import { Semaphore } from "@quiksend/core/utils/semaphore";
import { env, logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import type { EmailGateway } from "@quiksend/mail";
import { buildMime, createSmtpTransport, sendMime } from "@quiksend/mail";
import { decryptSeedImapConfig } from "@quiksend/mail";
import { getBoss, registerHandler } from "@quiksend/queue";
import { and, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { loadPauseContext, type PauseGroupKey } from "../deliverability/auto-pause-batch-loader.ts";
import { seedImapPool } from "../deliverability/imap-pool.ts";
import {
  classifyArrivalFolder,
  folderToStatus,
  openPooledSeedImap,
  resolveCanaryImapMockMode,
  searchCanaryMessages,
  type ImapMessageMatch,
  type PooledSeedImap,
} from "../deliverability/seed-imap.ts";
import { refreshDeliverabilitySnapshots } from "./deliverability-snapshot.ts";
import type { AutoPauseDetails } from "./canary-recover.ts";
import { fanoutWebhookEvent } from "./webhook-fanout.ts";

const IMAP_CONCURRENCY = 20;

export async function registerCanaryCheckHandler(): Promise<void> {
  await registerHandler("canary.check", async () => {
    await runCanaryCheck();
  });
  const boss = await getBoss();
  await boss.schedule("canary.check", "*/5 * * * *", {}, { tz: "UTC" });
  logger.info({ job: "canary.check" }, "canary check scheduled");
}

export async function runCanaryCheck(): Promise<void> {
  const dueCanaries = await db
    .select()
    .from(tables.canarySend)
    .where(
      and(
        eq(tables.canarySend.arrivalStatus, "pending"),
        isNotNull(tables.canarySend.sentAt),
        lt(tables.canarySend.expectedArrivalAt, sql`now() + interval '30 minutes'`),
        gt(tables.canarySend.sentAt, sql`now() - interval '24 hours'`),
      ),
    );

  const bySeed = groupBy(dueCanaries, (c) => c.seedInboxId);
  const semaphore = new Semaphore(IMAP_CONCURRENCY);
  await Promise.all(
    Object.entries(bySeed).map(([seedId, canaries]) =>
      semaphore.acquire(() => pollSeed(seedId, canaries)),
    ),
  );

  const timedOut = await db
    .update(tables.canarySend)
    .set({ arrivalStatus: "silent_drop", arrivedAt: sql`now()` })
    .where(
      and(
        eq(tables.canarySend.arrivalStatus, "pending"),
        isNotNull(tables.canarySend.sentAt),
        lt(tables.canarySend.sentAt, sql`now() - interval '24 hours'`),
      ),
    )
    .returning({
      id: tables.canarySend.id,
      organizationId: tables.canarySend.organizationId,
      sequenceId: tables.canarySend.sequenceId,
      mailboxId: tables.canarySend.mailboxId,
      seedInboxId: tables.canarySend.seedInboxId,
      canaryToken: tables.canarySend.canaryToken,
    });

  for (const row of timedOut) {
    await fanoutWebhookEvent({
      organizationId: row.organizationId,
      eventType: "deliverability.canary.silent_drop",
      payload: {
        canarySendId: row.id,
        sequenceId: row.sequenceId,
        mailboxId: row.mailboxId,
        seedInboxId: row.seedInboxId,
        canaryToken: row.canaryToken,
      },
    });
  }

  await refreshDeliverabilitySnapshots();
  await maybePauseCampaigns();
}

async function pollSeed(
  seedInboxId: string,
  canaries: (typeof tables.canarySend.$inferSelect)[],
): Promise<void> {
  const seed = await db.query.seedInbox.findFirst({
    where: eq(tables.seedInbox.id, seedInboxId),
  });
  if (!seed || !seed.active) return;

  const tokens = canaries.map((c) => c.canaryToken);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (resolveCanaryImapMockMode()) {
    const matches = await searchCanaryMessages(
      { host: "localhost", port: 1143, auth: { user: "x", pass: "x" }, secure: false },
      tokens,
      since,
    );
    await applyCanaryMatches(canaries, matches);
    return;
  }

  let config;
  try {
    config = decryptSeedImapConfig(seed.imapConfig, seed.organizationId);
  } catch (err) {
    logger.error({ err, seedInboxId }, "canary.check: failed to decrypt seed IMAP config");
    return;
  }

  const pooled = (await seedImapPool.getOrCreate(seedInboxId, () =>
    openPooledSeedImap(seedInboxId, config),
  )) as PooledSeedImap;
  const matches = await pooled.searchCanary(tokens, since);
  pooled.touch();
  await applyCanaryMatches(canaries, matches);
}

async function applyCanaryMatches(
  canaries: (typeof tables.canarySend.$inferSelect)[],
  matches: Map<string, ImapMessageMatch>,
): Promise<void> {
  for (const canary of canaries) {
    const match = matches.get(canary.canaryToken);
    if (!match) continue;

    const folder = classifyArrivalFolder(match.folder);
    const arrivalStatus = folderToStatus(folder, { isBounce: match.isBounce });
    if (!arrivalStatus) continue;

    await db
      .update(tables.canarySend)
      .set({
        arrivalStatus,
        arrivalFolder: match.isBounce ? "bounce" : folder,
        arrivedAt: new Date(),
        arrivalGatewayHeaders: match.headers,
      })
      .where(
        and(
          eq(tables.canarySend.id, canary.id),
          eq(tables.canarySend.organizationId, canary.organizationId),
        ),
      );

    await fanoutWebhookEvent({
      organizationId: canary.organizationId,
      eventType: "deliverability.canary.arrived",
      payload: {
        canarySendId: canary.id,
        sequenceId: canary.sequenceId,
        mailboxId: canary.mailboxId,
        seedInboxId: canary.seedInboxId,
        canaryToken: canary.canaryToken,
        arrivalStatus,
        arrivalFolder: match.isBounce ? "bounce" : folder,
      },
    });
  }
}

export async function maybePauseCampaigns(): Promise<void> {
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
    WHERE cs.sent_at > now() - interval '2 hours'
      AND cs.arrival_status <> 'pending'
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
    const decision = evaluateAutoPause(
      {
        sequenceId: row.sequence_id,
        mailboxId: row.mailbox_id,
        gateway: row.gateway,
        delivered,
        total,
      },
      threshold,
    );

    if (decision.action !== "pause") continue;

    await pauseSequenceCampaign(row.organization_id, row.sequence_id, {
      gateway: row.gateway,
      mailboxId: row.mailbox_id,
      deliverabilityPct: decision.deliverabilityPct ?? 0,
      threshold: decision.threshold ?? threshold,
      delivered,
      total,
    });
  }
}

async function pauseSequenceCampaign(
  organizationId: string,
  sequenceId: string,
  details: AutoPauseDetails,
): Promise<void> {
  await db
    .update(tables.enrollment)
    .set({ state: "paused", nextRunAt: null })
    .where(
      and(
        eq(tables.enrollment.organizationId, organizationId),
        eq(tables.enrollment.sequenceId, sequenceId),
        eq(tables.enrollment.mailboxId, details.mailboxId),
        inArray(tables.enrollment.state, ["active", "waiting", "waiting_manual"]),
      ),
    );

  await db
    .update(tables.mailbox)
    .set({
      enterpriseSafeAutoDowngraded: true,
      enterpriseSafeReason: "auto_downgraded",
    })
    .where(
      and(
        eq(tables.mailbox.id, details.mailboxId),
        eq(tables.mailbox.organizationId, organizationId),
      ),
    );

  await db.insert(tables.event).values({
    organizationId,
    type: "canary.silent_drop_detected",
    entityType: "sequence",
    entityId: sequenceId,
    payload: details,
  });

  await notifyAdminsOfAutoPause(organizationId, sequenceId, details);
  logger.warn({ organizationId, sequenceId, ...details }, "sequence auto-paused by canary");
}

async function notifyAdminsOfAutoPause(
  organizationId: string,
  sequenceId: string,
  details: {
    gateway: EmailGateway;
    deliverabilityPct: number;
    threshold: number;
    delivered: number;
    total: number;
  },
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
  const subject = `Campaign auto-paused: ${sequence.name}`;
  const text = [
    `Your campaign "${sequence.name}" has been auto-paused.`,
    `Reason: deliverability to ${details.gateway} dropped to ${details.deliverabilityPct}% (threshold: ${details.threshold}%).`,
    `Details: ${details.total} canary sends in the last 2 hours, ${details.delivered} arrived inbox, ${details.total - details.delivered} did not.`,
    `Review: ${reviewUrl}`,
  ].join("\n");

  const transport = createSmtpTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 1025,
    secure: false,
    fromAddress: "alerts@quiksend.local",
    fromName: "Quiksend Deliverability",
    compliance: {
      unsubscribeUrl: reviewUrl,
      senderPostalAddress: "Quiksend Systems",
      senderOrgName: "Quiksend",
    },
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
      logger.error({ err, email }, "failed to send auto-pause notification");
    });
  }
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    (out[key] ??= []).push(item);
  }
  return out;
}
