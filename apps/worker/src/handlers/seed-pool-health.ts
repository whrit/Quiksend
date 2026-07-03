import { env, logger } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import { decryptSeedImapConfig, buildMime, createSmtpTransport, sendMime } from "@quiksend/mail";
import type { SeedImapConfigPlain } from "@quiksend/mail";
import { getBoss, registerHandler } from "@quiksend/queue";
import { and, eq, isNull } from "drizzle-orm";
import { ImapFlow } from "imapflow";

const DORMANCY_WARN_THRESHOLD = 3;
const DORMANCY_WINDOW_DAYS = 30;

export interface SeedHealthResult {
  readonly seedId: string;
  readonly email: string;
  readonly ok: boolean;
  readonly messageCount30d: number;
  readonly dormancyWarning: boolean;
  readonly error?: string;
}

export async function checkSeedImapHealth(
  config: SeedImapConfigPlain,
): Promise<{ ok: true; messageCount30d: number } | { ok: false; error: string }> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - DORMANCY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const searchResult = await client.search({ since }, { uid: true });
      const messageCount30d = Array.isArray(searchResult) ? searchResult.length : 0;
      return { ok: true, messageCount30d };
    } finally {
      lock.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function runSeedPoolHealthCheck(): Promise<SeedHealthResult[]> {
  const seeds = await db.query.seedInbox.findMany({
    where: and(isNull(tables.seedInbox.organizationId), eq(tables.seedInbox.active, true)),
  });

  const results: SeedHealthResult[] = [];

  for (const seed of seeds) {
    let config: SeedImapConfigPlain;
    try {
      config = decryptSeedImapConfig(seed.imapConfig, seed.organizationId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({
        seedId: seed.id,
        email: seed.email,
        ok: false,
        messageCount30d: 0,
        dormancyWarning: false,
        error,
      });
      await recordHealthFailure(seed.id, seed.email, error);
      continue;
    }

    const health = await checkSeedImapHealth(config);
    if (!health.ok) {
      results.push({
        seedId: seed.id,
        email: seed.email,
        ok: false,
        messageCount30d: 0,
        dormancyWarning: false,
        error: health.error,
      });
      await recordHealthFailure(seed.id, seed.email, health.error);
      continue;
    }

    const dormancyWarning = health.messageCount30d < DORMANCY_WARN_THRESHOLD;
    if (dormancyWarning) {
      logger.warn(
        { seedId: seed.id, email: seed.email, messageCount30d: health.messageCount30d },
        "seed pool health: low message volume in last 30 days",
      );
    }

    results.push({
      seedId: seed.id,
      email: seed.email,
      ok: true,
      messageCount30d: health.messageCount30d,
      dormancyWarning,
    });
  }

  return results;
}

async function recordHealthFailure(seedId: string, email: string, error: string): Promise<void> {
  logger.warn({ seedId, email, error }, "seed_pool.health_check_failed");

  const systemOrgId = env.QUIKSEND_SYSTEM_ORG_ID;
  if (systemOrgId) {
    await db.insert(tables.event).values({
      organizationId: systemOrgId,
      type: "seed_pool.health_check_failed",
      entityType: "seed_inbox",
      entityId: seedId,
      payload: { email, error },
    });
  }

  if (env.SYSTEM_ADMIN_EMAIL && env.SMTP_HOST) {
    await notifyAdminHealthFailure(email, error).catch((err) => {
      logger.error({ err }, "failed to email SYSTEM_ADMIN_EMAIL for seed health failure");
    });
  }
}

async function notifyAdminHealthFailure(email: string, error: string): Promise<void> {
  const adminEmail = env.SYSTEM_ADMIN_EMAIL;
  if (!adminEmail) return;

  const subject = `Seed pool health check failed: ${email}`;
  const text = `Provider seed inbox ${email} failed IMAP health check.\n\nError: ${error}`;
  const transport = createSmtpTransport({
    host: env.SMTP_HOST!,
    port: env.SMTP_PORT ?? 1025,
    secure: false,
    fromAddress: "alerts@quiksend.local",
    fromName: "Quiksend Seed Pool",
    compliance: {
      unsubscribeUrl: env.BETTER_AUTH_URL ?? "http://localhost:3000",
      senderPostalAddress: "Quiksend Systems",
      senderOrgName: "Quiksend",
    },
  });
  const mime = buildMime({
    from: { email: "alerts@quiksend.local", name: "Quiksend Seed Pool" },
    to: [{ email: adminEmail }],
    subject,
    html: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
    text,
    compliance: {
      unsubscribeUrl: env.BETTER_AUTH_URL ?? "http://localhost:3000",
      senderPostalAddress: "Quiksend Systems",
      senderOrgName: "Quiksend",
    },
  });
  await sendMime(transport, mime);
}

export async function registerSeedPoolHealthHandler(): Promise<void> {
  await registerHandler("seed_pool.health_check", async () => {
    await runSeedPoolHealthCheck();
  });

  const boss = await getBoss();
  await boss.schedule("seed_pool.health_check", "0 0 * * *", {}, { tz: "UTC" });
  logger.info(
    { job: "seed_pool.health_check", cron: "0 0 * * *" },
    "seed pool health cron scheduled",
  );
}
