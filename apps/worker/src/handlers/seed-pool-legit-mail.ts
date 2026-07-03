import { randomUUID } from "node:crypto";
import { env, logger } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import { buildMime, createSmtpTransport, sendMime } from "@quiksend/mail";
import { getBoss, registerHandler } from "@quiksend/queue";
import { and, eq, gte, isNull, sql } from "drizzle-orm";

const MAX_MESSAGES_PER_SEED_PER_WEEK = 5;

interface LegitMailTemplate {
  readonly subject: string;
  readonly body: string;
}

const LEGIT_MAIL_TEMPLATES: readonly LegitMailTemplate[] = [
  {
    subject: "Notes from Tuesday sync — Q3 pipeline",
    body: "Hi team,\n\nQuick recap from today's sync:\n- Pipeline review moved to Thursday 2pm ET.\n- Finance needs the updated forecast by EOD Wednesday.\n\nThanks,\nAlex",
  },
  {
    subject: "Weekly ops digest",
    body: "Good morning,\n\nThis week's highlights:\n- Deploy completed Sunday 03:00 UTC (no customer impact).\n- Two support tickets closed; one open re: SSO timeout.\n\n— Ops",
  },
  {
    subject: "Invoice reminder",
    body: "Hello,\n\nFriendly reminder that invoice INV-20481 is due this Friday.\n\nAccounts Receivable",
  },
  {
    subject: "Invitation: Design review @ Thu 11:00am",
    body: "Hi,\n\nYou're invited to a design review Thursday at 11:00am ET.\n\nJordan",
  },
  {
    subject: "Re: vendor contract renewal",
    body: "Following up on the renewal — legal signed off on the redlines.\n\nPlease confirm the start date.\n\nSam",
  },
] as const;

function pickTemplate(index: number): LegitMailTemplate {
  return LEGIT_MAIL_TEMPLATES[index % LEGIT_MAIL_TEMPLATES.length]!;
}

function pickRecipient<T>(items: readonly T[], excludeIndex: number): T | null {
  if (items.length < 2) return null;
  const candidates = items.filter((_, i) => i !== excludeIndex);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

export async function runSeedPoolLegitMail(): Promise<number> {
  if (!env.SMTP_HOST) {
    logger.warn("seed_pool.generate_legit_mail skipped — SMTP_HOST not configured");
    return 0;
  }

  const seeds = await db.query.seedInbox.findMany({
    where: and(isNull(tables.seedInbox.organizationId), eq(tables.seedInbox.active, true)),
    orderBy: (s, { asc }) => [asc(s.gateway), asc(s.email)],
  });

  if (seeds.length < 2) {
    logger.info("seed_pool.generate_legit_mail skipped — need at least 2 provider seeds");
    return 0;
  }

  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sentThisWeek = await db
    .select({
      seedId: tables.event.entityId,
      count: sql<number>`count(*)::int`,
    })
    .from(tables.event)
    .where(
      and(
        eq(tables.event.type, "seed_pool.legit_mail_sent"),
        gte(tables.event.createdAt, weekStart),
      ),
    )
    .groupBy(tables.event.entityId);

  const sentCountBySeed = new Map(sentThisWeek.map((row) => [row.seedId, row.count]));

  const transport = createSmtpTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 1025,
    secure: false,
    fromAddress: "seed-pool@quiksend.systems",
    fromName: "Seed Pool",
    compliance: {
      unsubscribeUrl: env.BETTER_AUTH_URL ?? "http://localhost:3000",
      senderPostalAddress: "Quiksend Systems",
      senderOrgName: "Quiksend",
    },
  });

  let sent = 0;
  const systemOrgId = env.QUIKSEND_SYSTEM_ORG_ID;

  for (let i = 0; i < seeds.length; i++) {
    const fromSeed = seeds[i]!;
    const alreadySent = sentCountBySeed.get(fromSeed.id) ?? 0;
    if (alreadySent >= MAX_MESSAGES_PER_SEED_PER_WEEK) continue;

    const toSeed = pickRecipient(seeds, i);
    if (!toSeed) continue;

    const template = pickTemplate(i + sent);
    const fromLocal = fromSeed.email.split("@")[0] ?? "sender";
    const subject = template.subject;
    const text = template.body;

    const mime = buildMime({
      from: { email: fromSeed.email, name: fromLocal },
      to: [{ email: toSeed.email, name: toSeed.email.split("@")[0] }],
      subject,
      html: `<p>${text.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br/>")}</p>`,
      text,
      compliance: {
        unsubscribeUrl: env.BETTER_AUTH_URL ?? "http://localhost:3000",
        senderPostalAddress: "Quiksend Systems",
        senderOrgName: "Quiksend",
      },
    });

    await sendMime(transport, mime, { from: fromSeed.email, to: [toSeed.email] });
    sent += 1;

    logger.info({ from: fromSeed.email, to: toSeed.email, subject }, "seed_pool.legit_mail_sent");

    if (systemOrgId) {
      await db.insert(tables.event).values({
        organizationId: systemOrgId,
        type: "seed_pool.legit_mail_sent",
        entityType: "seed_inbox",
        entityId: fromSeed.id,
        payload: {
          to: toSeed.email,
          subject,
          messageId: randomUUID(),
        },
      });
    }
  }

  return sent;
}

export async function registerSeedPoolLegitMailHandler(): Promise<void> {
  await registerHandler("seed_pool.generate_legit_mail", async () => {
    await runSeedPoolLegitMail();
  });

  const boss = await getBoss();
  await boss.schedule("seed_pool.generate_legit_mail", "0 0 * * 0", {}, { tz: "UTC" });
  logger.info(
    { job: "seed_pool.generate_legit_mail", cron: "0 0 * * 0" },
    "seed pool legit-mail cron scheduled",
  );
}
