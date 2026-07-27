import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { enqueueWithRetries, registerHandler } from "@quiksend/queue";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { emailDomain } from "@quiksend/core";

const CHUNK_SIZE = 500;

function normalizeEmail(str: string): string | null {
  const trimmed = str.trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

type DedupePolicy = "skip_existing" | "update_existing";

type SuppressionReason = "bounce" | "unsubscribe" | "manual" | "complaint";

type ProspectStatus = "new" | "active" | "replied" | "bounced" | "unsubscribed" | "do_not_contact";

function prospectStatusForSuppression(reason: SuppressionReason): ProspectStatus {
  if (reason === "bounce") return "bounced";
  if (reason === "unsubscribe") return "unsubscribed";
  return "do_not_contact";
}

async function loadSuppressionForEmails(
  organizationId: string,
  emails: string[],
): Promise<Map<string, SuppressionReason>> {
  if (emails.length === 0) return new Map();

  const domains = [...new Set(emails.map((email) => emailDomain(email)))];
  const rows = await db
    .select({
      value: tables.suppression.value,
      valueType: tables.suppression.valueType,
      reason: tables.suppression.reason,
    })
    .from(tables.suppression)
    .where(
      and(
        eq(tables.suppression.organizationId, organizationId),
        or(
          and(eq(tables.suppression.valueType, "email"), inArray(tables.suppression.value, emails)),
          and(
            eq(tables.suppression.valueType, "domain"),
            inArray(tables.suppression.value, domains),
          ),
        ),
      ),
    );

  const emailReasons = new Map<string, SuppressionReason>();
  const domainReasons = new Map<string, SuppressionReason>();
  for (const row of rows) {
    if (row.valueType === "email") {
      emailReasons.set(row.value, row.reason);
    } else {
      domainReasons.set(row.value, row.reason);
    }
  }

  const suppressed = new Map<string, SuppressionReason>();
  for (const email of emails) {
    const direct = emailReasons.get(email);
    if (direct) {
      suppressed.set(email, direct);
      continue;
    }
    const domainReason = domainReasons.get(emailDomain(email));
    if (domainReason) {
      suppressed.set(email, domainReason);
    }
  }
  return suppressed;
}

interface ParsedProspectRow {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  timezone?: string | null;
}

interface ParsedCompanyRow {
  name?: string | null;
  domain?: string | null;
  industry?: string | null;
  website?: string | null;
}

interface ValidCsvRow {
  rowNumber: number;
  prospect: ParsedProspectRow;
  company?: ParsedCompanyRow;
}

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "gmx.com",
]);

function normalizeDomain(str: string): string | null {
  let value = str.trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0] ?? "";
  value = value.split("?")[0] ?? "";
  value = value.split("#")[0] ?? "";
  value = value.split(":")[0] ?? "";

  if (!value || value.includes("@") || !value.includes(".")) return null;
  if (FREE_MAIL_DOMAINS.has(value)) return null;

  return value;
}

async function resolveCompanyId(
  organizationId: string,
  company: ValidCsvRow["company"],
): Promise<string | null> {
  if (!company) return null;

  const domain = company.domain ? normalizeDomain(company.domain) : null;
  const name = company.name?.trim() || null;

  if (domain) {
    const existing = await db.query.company.findFirst({
      where: and(
        eq(tables.company.organizationId, organizationId),
        eq(tables.company.domain, domain),
        isNull(tables.company.deletedAt),
      ),
    });
    if (existing) return existing.id;

    const [created] = await db
      .insert(tables.company)
      .values({
        organizationId,
        domain,
        name: name ?? domain,
        industry: company.industry,
        website: company.website,
      })
      .returning();
    return created?.id ?? null;
  }

  if (name) {
    const existing = await db.query.company.findFirst({
      where: and(
        eq(tables.company.organizationId, organizationId),
        sql`lower(${tables.company.name}) = ${name.toLowerCase()}`,
        isNull(tables.company.deletedAt),
      ),
    });
    if (existing) return existing.id;

    const [created] = await db.insert(tables.company).values({ organizationId, name }).returning();
    return created?.id ?? null;
  }

  return null;
}

async function importProspectRow(
  organizationId: string,
  row: ValidCsvRow,
  dedupePolicy: DedupePolicy,
  suppressions: Map<string, SuppressionReason>,
): Promise<"created" | "updated" | "skipped"> {
  const email = normalizeEmail(row.prospect.email);
  if (!email) throw new Error("Invalid email");

  const suppressionReason = suppressions.get(email);
  const suppressedStatus = suppressionReason
    ? prospectStatusForSuppression(suppressionReason)
    : null;

  const companyId = await resolveCompanyId(organizationId, row.company);

  const existing = await db.query.prospect.findFirst({
    where: and(
      eq(tables.prospect.organizationId, organizationId),
      eq(tables.prospect.email, email),
    ),
  });

  const prospectValues = {
    firstName: row.prospect.firstName ?? null,
    lastName: row.prospect.lastName ?? null,
    title: row.prospect.title ?? null,
    phone: row.prospect.phone ?? null,
    linkedinUrl: row.prospect.linkedinUrl ?? null,
    timezone: row.prospect.timezone ?? null,
    companyId,
    source: "csv" as const,
    deletedAt: null,
    ...(suppressedStatus ? { status: suppressedStatus } : {}),
  };

  if (existing) {
    if (existing.deletedAt || dedupePolicy === "update_existing" || suppressedStatus) {
      await db
        .update(tables.prospect)
        .set(prospectValues)
        .where(
          and(
            eq(tables.prospect.id, existing.id),
            eq(tables.prospect.organizationId, organizationId),
          ),
        );
      if (suppressedStatus) return "skipped";
      return existing.deletedAt ? "created" : "updated";
    }
    return "skipped";
  }

  if (suppressedStatus) {
    await db.insert(tables.prospect).values({
      organizationId,
      email,
      ...prospectValues,
    });
    return "skipped";
  }

  await db.insert(tables.prospect).values({
    organizationId,
    email,
    ...prospectValues,
  });
  return "created";
}

export async function registerImportProspectsHandler(): Promise<void> {
  await registerHandler(
    "import.process",
    async ({ batchId, organizationId, dedupePolicy, rows }) => {
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let erroredCount = 0;
      const importedEmails: string[] = [];

      try {
        await db
          .update(tables.importBatch)
          .set({ status: "processing" })
          .where(
            and(
              eq(tables.importBatch.id, batchId),
              eq(tables.importBatch.organizationId, organizationId),
            ),
          );

        for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
          const chunk = rows.slice(offset, offset + CHUNK_SIZE);
          const chunkEmails = [
            ...new Set(
              chunk
                .map((row) => normalizeEmail(row.prospect.email))
                .filter((email): email is string => Boolean(email)),
            ),
          ];
          const suppressions = await loadSuppressionForEmails(organizationId, chunkEmails);

          for (const row of chunk) {
            try {
              const outcome = await importProspectRow(
                organizationId,
                row,
                dedupePolicy,
                suppressions,
              );
              const email = normalizeEmail(row.prospect.email);
              if (outcome === "created") {
                createdCount += 1;
                if (email) importedEmails.push(email);
              } else if (outcome === "updated") {
                updatedCount += 1;
                if (email) importedEmails.push(email);
              } else {
                skippedCount += 1;
              }
            } catch (err) {
              erroredCount += 1;
              await db.insert(tables.importError).values({
                batchId,
                rowNumber: row.rowNumber,
                raw: row.prospect as unknown as Record<string, unknown>,
                reason: err instanceof Error ? err.message : "Import failed",
              });
            }
          }

          await db
            .update(tables.importBatch)
            .set({ createdCount, updatedCount, skippedCount, erroredCount })
            .where(
              and(
                eq(tables.importBatch.id, batchId),
                eq(tables.importBatch.organizationId, organizationId),
              ),
            );
        }

        await db
          .update(tables.importBatch)
          .set({
            createdCount,
            updatedCount,
            skippedCount,
            erroredCount,
            status: "completed",
          })
          .where(
            and(
              eq(tables.importBatch.id, batchId),
              eq(tables.importBatch.organizationId, organizationId),
            ),
          );

        logger.info(
          { batchId, organizationId, createdCount, updatedCount, skippedCount, erroredCount },
          "import.process completed",
        );

        const emails = [...new Set(importedEmails)];
        if (emails.length > 0) {
          await enqueueWithRetries("gateway.detect_bulk", { emails });
          await enqueueWithRetries("gateway.apply_classification", { organizationId });
        }
      } catch (err) {
        logger.error({ err, batchId, organizationId }, "import.process failed");
        await db
          .update(tables.importBatch)
          .set({ status: "failed", erroredCount: erroredCount + 1 })
          .where(
            and(
              eq(tables.importBatch.id, batchId),
              eq(tables.importBatch.organizationId, organizationId),
            ),
          );
        throw err;
      }
    },
  );
}
