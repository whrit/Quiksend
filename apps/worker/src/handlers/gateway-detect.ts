import { logger } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
import { detectEmailGateway, type EmailGateway } from "@quiksend/mail/gateway-detect";
import { enqueueWithRetries, registerHandler } from "@quiksend/queue";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

const DNS_CONCURRENCY = 50;
const CACHE_TTL_DAYS_HIGH = 30;
const CACHE_TTL_DAYS_LOW = 7;
const CACHE_TTL_HOURS_FAILURE = 24;

function extractDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

function ttlForConfidence(confidence: "high" | "medium" | "low", isFailure = false): Date {
  if (isFailure) {
    return new Date(Date.now() + CACHE_TTL_HOURS_FAILURE * 60 * 60 * 1000);
  }
  const days = confidence === "low" ? CACHE_TTL_DAYS_LOW : CACHE_TTL_DAYS_HIGH;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function upsertDomainClassification(
  domain: string,
  result: Awaited<ReturnType<typeof detectEmailGateway>>,
): Promise<void> {
  const isFailure = result.gateway === "unknown";
  await db
    .insert(tables.gatewayClassification)
    .values({
      emailDomain: domain,
      gateway: result.gateway,
      mxRecords: result.mxRecords,
      evidence: result.evidence,
      confidence: result.confidence,
      classifiedAt: new Date(),
      ttlUntil: ttlForConfidence(result.confidence, isFailure),
    })
    .onConflictDoUpdate({
      target: tables.gatewayClassification.emailDomain,
      set: {
        gateway: result.gateway,
        mxRecords: result.mxRecords,
        evidence: result.evidence,
        confidence: result.confidence,
        classifiedAt: new Date(),
        ttlUntil: ttlForConfidence(result.confidence, isFailure),
      },
    });
}

async function applyClassificationToProspects(
  domain: string,
  gateway: EmailGateway,
  evidence: Awaited<ReturnType<typeof detectEmailGateway>>["evidence"],
  organizationId?: string,
): Promise<number> {
  const conditions = [
    sql`lower(split_part(${tables.prospect.email}, '@', 2)) = ${domain}`,
    isNull(tables.prospect.deletedAt),
  ];
  if (organizationId) {
    conditions.push(eq(tables.prospect.organizationId, organizationId));
  }

  const updated = await db
    .update(tables.prospect)
    .set({
      emailGateway: gateway,
      gatewayClassifiedAt: new Date(),
      gatewayEvidence: evidence,
    })
    .where(and(...conditions))
    .returning({ id: tables.prospect.id });

  return updated.length;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++]!;
      await fn(current);
    }
  });
  await Promise.all(workers);
}

async function classifyDomain(domain: string): Promise<void> {
  const probeEmail = `probe@${domain}`;
  const result = await detectEmailGateway(probeEmail);
  await upsertDomainClassification(domain, result);
}

export async function registerGatewayDetectHandlers(): Promise<void> {
  await registerHandler("gateway.detect_single", async ({ email }) => {
    const domain = extractDomain(email);
    if (!domain) {
      logger.warn({ email }, "gateway.detect_single skipped invalid email");
      return;
    }

    await classifyDomain(domain);
    const row = await db.query.gatewayClassification.findFirst({
      where: eq(tables.gatewayClassification.emailDomain, domain),
    });
    if (!row) return;

    const count = await applyClassificationToProspects(domain, row.gateway, row.evidence);
    logger.info(
      { domain, gateway: row.gateway, prospectsUpdated: count },
      "gateway.detect_single done",
    );
  });

  await registerHandler("gateway.detect_bulk", async ({ emails }) => {
    const domains = [...new Set(emails.map(extractDomain).filter((d): d is string => Boolean(d)))];
    await runWithConcurrency(domains, DNS_CONCURRENCY, async (domain) => {
      await classifyDomain(domain);
    });

    await enqueueWithRetries("gateway.apply_classification", {});
    logger.info({ domainCount: domains.length }, "gateway.detect_bulk done");
  });

  await registerHandler("gateway.apply_classification", async ({ organizationId, domain }) => {
    if (domain) {
      const row = await db.query.gatewayClassification.findFirst({
        where: eq(tables.gatewayClassification.emailDomain, domain),
      });
      if (row) {
        await applyClassificationToProspects(domain, row.gateway, row.evidence, organizationId);
      }
      return;
    }

    const prospectConditions = [
      isNull(tables.prospect.emailGateway),
      isNull(tables.prospect.deletedAt),
    ];
    if (organizationId) {
      prospectConditions.push(eq(tables.prospect.organizationId, organizationId));
    }

    const unclassified = await db
      .select({
        id: tables.prospect.id,
        email: tables.prospect.email,
        organizationId: tables.prospect.organizationId,
      })
      .from(tables.prospect)
      .where(and(...prospectConditions))
      .limit(5000);

    const domainsNeeded = [
      ...new Set(
        unclassified.map((p) => extractDomain(p.email)).filter((d): d is string => Boolean(d)),
      ),
    ];

    const cached =
      domainsNeeded.length > 0
        ? await db.query.gatewayClassification.findMany({
            where: inArray(tables.gatewayClassification.emailDomain, domainsNeeded),
          })
        : [];

    const cacheByDomain = new Map(cached.map((row) => [row.emailDomain, row]));

    for (const prospect of unclassified) {
      const d = extractDomain(prospect.email);
      if (!d) continue;
      const row = cacheByDomain.get(d);
      if (!row) {
        await enqueueWithRetries("gateway.detect_single", { email: prospect.email });
        continue;
      }
      await db
        .update(tables.prospect)
        .set({
          emailGateway: row.gateway,
          gatewayClassifiedAt: new Date(),
          gatewayEvidence: row.evidence,
        })
        .where(
          and(
            eq(tables.prospect.id, prospect.id),
            eq(tables.prospect.organizationId, prospect.organizationId),
          ),
        );
    }
  });

  await registerHandler("gateway.sweep_stale", async () => {
    const stale = await db.query.gatewayClassification.findMany({
      where: lt(tables.gatewayClassification.ttlUntil, new Date()),
      limit: 500,
    });

    for (const row of stale) {
      const before = row.gateway;
      await classifyDomain(row.emailDomain);
      const after = await db.query.gatewayClassification.findFirst({
        where: eq(tables.gatewayClassification.emailDomain, row.emailDomain),
      });
      if (after && after.gateway !== before) {
        await applyClassificationToProspects(row.emailDomain, after.gateway, after.evidence);
        logger.info(
          { domain: row.emailDomain, from: before, to: after.gateway },
          "gateway migration detected",
        );
      }
    }
  });
}

export async function registerGatewaySweepCron(): Promise<void> {
  const { getBoss } = await import("@quiksend/queue");
  const boss = await getBoss();
  await boss.createQueue("gateway.sweep_stale");
  await boss.schedule("gateway.sweep_stale", "0 3 * * *", {}, { tz: "UTC" });
  logger.info({ job: "gateway.sweep_stale" }, "gateway sweep cron scheduled");
}

export { extractDomain, applyClassificationToProspects, classifyDomain };
