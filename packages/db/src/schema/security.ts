import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth.ts";

/** Per-IP leaky-bucket counter for unauthenticated auth endpoint rate limiting. */
export const authRateBucket = pgTable("auth_rate_bucket", {
  key: text("key").primaryKey(),
  tokens: integer("tokens").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Idempotency store for inbound Nango webhooks — prevents replay amplification. */
export const nangoWebhookProcessed = pgTable(
  "nango_webhook_processed",
  {
    eventId: text("event_id").notNull(),
    connectionId: text("connection_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.connectionId] }),
    index("nango_webhook_processed_at").on(table.processedAt),
  ],
);

/**
 * Server-owned entitlements and quotas for an organization — deliverability
 * Pro expiry plus per-resource limits. This is the ONLY source of truth for
 * paid capabilities. `organization.metadata` is client-writable via Better
 * Auth's org-update endpoint; nothing may ever read it to decide entitlement.
 * Orgs without a row here get the defaults in `organization-limits.ts`.
 */
export const organizationLimit = pgTable("organization_limit", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  deliverabilityProUntil: timestamp("deliverability_pro_until", { withTimezone: true }),
  mailboxLimit: integer("mailbox_limit").default(5).notNull(),
  apiRequestsPerDay: integer("api_requests_per_day").default(10_000).notNull(),
  aiResearchPerMonth: integer("ai_research_per_month").default(1_000).notNull(),
  dnsChecksPerDay: integer("dns_checks_per_day").default(5_000).notNull(),
  importRowsPerJob: integer("import_rows_per_job").default(5_000).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/**
 * Atomic per-period usage counters backing the quota consumer in
 * `organization-limits.ts`. `period` is a UTC bucket key ("day" resources use
 * YYYY-MM-DD, "month" resources use YYYY-MM; the lifetime mailbox-slot
 * reservation uses the literal "lifetime"). Consumption is always one
 * `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE count < limit RETURNING`
 * statement — never a read followed by a separate write.
 */
export const organizationUsage = pgTable(
  "organization_usage",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    period: text("period").notNull(),
    count: integer("count").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.resource, table.period] }),
    index("organization_usage_org_idx").on(table.organizationId),
  ],
);
