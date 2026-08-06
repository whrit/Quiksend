import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { db } from "./client.ts";
import * as tables from "./schema/index.ts";
import type * as schema from "./schema/index.ts";

type DbTx = PostgresJsDatabase<typeof schema>;

/**
 * Server-owned entitlements and quotas. This is the ONLY place entitlement
 * decisions may be read from. `organization.metadata` is client-writable
 * (Better Auth's org-update endpoint lets an owner set arbitrary metadata) —
 * it must never be consulted for billing/paid-feature decisions again.
 */
export interface OrganizationLimits {
  deliverabilityPro: boolean;
  mailboxLimit: number;
  apiRequestsPerDay: number;
  aiResearchPerMonth: number;
  dnsChecksPerDay: number;
  importRowsPerJob: number;
}

const DEFAULT_LIMITS: Omit<OrganizationLimits, "deliverabilityPro"> = {
  mailboxLimit: 5,
  apiRequestsPerDay: 10_000,
  aiResearchPerMonth: 1_000,
  dnsChecksPerDay: 5_000,
  importRowsPerJob: 5_000,
};

/** Reads the server-owned limits row, falling back to defaults for an org that never had one provisioned. */
export async function getOrganizationLimits(
  organizationId: string,
  executor: DbTx = db,
): Promise<OrganizationLimits> {
  const row = await executor.query.organizationLimit.findFirst({
    where: eq(tables.organizationLimit.organizationId, organizationId),
  });
  if (!row) return { deliverabilityPro: false, ...DEFAULT_LIMITS };

  return {
    deliverabilityPro:
      row.deliverabilityProUntil != null && row.deliverabilityProUntil.getTime() > Date.now(),
    mailboxLimit: row.mailboxLimit,
    apiRequestsPerDay: row.apiRequestsPerDay,
    aiResearchPerMonth: row.aiResearchPerMonth,
    dnsChecksPerDay: row.dnsChecksPerDay,
    importRowsPerJob: row.importRowsPerJob,
  };
}

/** For `isEntitledToProviderSeeds` — the boolean plus the raw expiry, if any. */
export async function getDeliverabilityProStatus(
  organizationId: string,
  executor: DbTx = db,
): Promise<{ entitled: boolean; expiresAt: string | null }> {
  const row = await executor.query.organizationLimit.findFirst({
    where: eq(tables.organizationLimit.organizationId, organizationId),
    columns: { deliverabilityProUntil: true },
  });
  if (!row?.deliverabilityProUntil) return { entitled: false, expiresAt: null };
  return {
    entitled: row.deliverabilityProUntil.getTime() > Date.now(),
    expiresAt: row.deliverabilityProUntil.toISOString(),
  };
}

export async function isDeliverabilityProEntitled(
  organizationId: string,
  executor: DbTx = db,
): Promise<boolean> {
  return (await getDeliverabilityProStatus(organizationId, executor)).entitled;
}

/** Protected metadata keys that must never survive a workspace-initiated metadata write. */
const PROTECTED_METADATA_KEYS = ["entitlements", "billing"] as const;

/** Strips billing/entitlement keys before persisting an app-writable metadata patch. */
export function stripProtectedMetadataKeys<T extends Record<string, unknown>>(
  metadata: T,
): Omit<T, (typeof PROTECTED_METADATA_KEYS)[number]> {
  const next = { ...metadata };
  for (const key of PROTECTED_METADATA_KEYS) delete next[key];
  return next;
}

function currentPeriod(unit: "day" | "month"): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  if (unit === "month") return `${y}-${m}`;
  return `${y}-${m}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Atomically consumes `amount` units of `resource` for `period`, refusing when
 * doing so would exceed `limit`. One `INSERT ... ON CONFLICT ... DO UPDATE ...
 * WHERE ... RETURNING` statement — no read-then-write race window, so two
 * concurrent callers can never together exceed `limit`.
 */
async function consumeInTx(
  executor: DbTx,
  organizationId: string,
  resource: string,
  period: string,
  limit: number,
  amount: number,
): Promise<boolean> {
  if (limit <= 0) return false;

  const rows = await executor
    .insert(tables.organizationUsage)
    .values({ organizationId, resource, period, count: amount })
    .onConflictDoUpdate({
      target: [
        tables.organizationUsage.organizationId,
        tables.organizationUsage.resource,
        tables.organizationUsage.period,
      ],
      set: {
        count: sql`${tables.organizationUsage.count} + ${amount}`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${tables.organizationUsage.count} + ${amount} <= ${limit}`,
    })
    .returning({ count: tables.organizationUsage.count });

  return rows.length > 0;
}

export type PeriodicResource = "apiRequest" | "aiResearch" | "dnsCheck";

const PERIOD_UNIT: Record<PeriodicResource, "day" | "month"> = {
  apiRequest: "day",
  dnsCheck: "day",
  aiResearch: "month",
};

/** Consumes one unit of a day/month-scoped quota for `organizationId`. */
export async function consumePeriodicQuota(
  organizationId: string,
  resource: PeriodicResource,
  executor: DbTx = db,
): Promise<boolean> {
  const limits = await getOrganizationLimits(organizationId, executor);
  const limit =
    resource === "apiRequest"
      ? limits.apiRequestsPerDay
      : resource === "aiResearch"
        ? limits.aiResearchPerMonth
        : limits.dnsChecksPerDay;
  return consumeInTx(
    executor,
    organizationId,
    resource,
    currentPeriod(PERIOD_UNIT[resource]),
    limit,
    1,
  );
}

/**
 * Reserves one mailbox slot against `mailboxLimit`. MUST run inside the same
 * `tx` as the mailbox insert so a failed insert rolls the reservation back
 * with it — otherwise a failure after reservation would leak quota forever.
 */
export async function reserveMailboxSlotInTx(tx: DbTx, organizationId: string): Promise<boolean> {
  const limits = await getOrganizationLimits(organizationId, tx);
  return consumeInTx(tx, organizationId, "mailbox", "lifetime", limits.mailboxLimit, 1);
}

/** Releases one mailbox slot, e.g. on mailbox deletion. Floors at zero; never races the reserve path's limit check. */
export async function releaseMailboxSlotInTx(tx: DbTx, organizationId: string): Promise<void> {
  await tx
    .update(tables.organizationUsage)
    .set({ count: sql`greatest(${tables.organizationUsage.count} - 1, 0)`, updatedAt: sql`now()` })
    .where(
      and(
        eq(tables.organizationUsage.organizationId, organizationId),
        eq(tables.organizationUsage.resource, "mailbox"),
        eq(tables.organizationUsage.period, "lifetime"),
      ),
    );
}
