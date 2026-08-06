import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";

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

/**
 * Append-only, organization-scoped audit trail for privileged mutations
 * (authentication reauthentication, API keys, invitations/members, mailbox
 * credentials, entitlements, data export, organization deletion). Rows are
 * written once and never updated or deleted by app code — the retention
 * purge only trims rows past the documented compliance window.
 *
 * `metadata` MUST be redacted before insert (see `redactAuditMetadata` in
 * `packages/db/src/audit.ts`) — this table must never receive secrets,
 * password material, tokens, or message bodies.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(), // "user" | "api_key" | "system"
    actorId: text("actor_id"),
    action: text("action").notNull(), // e.g. "api_key.create", "organization.delete_requested"
    entityType: text("entity_type").notNull(), // e.g. "api_key", "mailbox", "organization"
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_org_created_idx").on(table.organizationId, table.createdAt.desc()),
    index("audit_log_org_action_idx").on(table.organizationId, table.action),
  ],
);

/**
 * Server-owned organization lifecycle state — deletion request + immediate
 * send-disable flag + purge progress. One row per organization, created on
 * first deletion request (`organization-delete.ts`). `sendingDisabledAt` is
 * checked by `isSendSuppressed` (`packages/db/src/suppression.ts`), the
 * single chokepoint every send path already shares, so deletion blocks
 * sending immediately with no per-caller changes required.
 */
export const organizationLifecycle = pgTable("organization_lifecycle", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  deletionRequestedByUserId: text("deletion_requested_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  sendingDisabledAt: timestamp("sending_disabled_at", { withTimezone: true }),
  purgeCompletedAt: timestamp("purge_completed_at", { withTimezone: true }),
});
