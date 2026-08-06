import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";

export const mailboxProviderEnum = pgEnum("mailbox_provider", ["gmail", "microsoft", "smtp"]);

const defaultSendWindow = {
  timezone: "UTC",
  window: {
    mon: [[9, 17]],
    tue: [[9, 17]],
    wed: [[9, 17]],
    thu: [[9, 17]],
    fri: [[9, 17]],
  },
} as const;

export const mailbox = pgTable(
  "mailbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id),
    provider: mailboxProviderEnum("provider").notNull(),
    address: text("address").notNull(),
    displayName: text("display_name"),
    fromName: text("from_name"),
    nangoConnectionId: text("nango_connection_id"),
    smtpConfig: jsonb("smtp_config"),
    dailyCap: integer("daily_cap").default(50).notNull(),
    sendWindow: jsonb("send_window").default(defaultSendWindow).notNull(),
    throttleSeconds: integer("throttle_seconds").default(90).notNull(),
    signatureHtml: text("signature_html"),
    spfOk: boolean("spf_ok"),
    dkimOk: boolean("dkim_ok"),
    dmarcOk: boolean("dmarc_ok"),
    healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
    healthNotes: jsonb("health_notes"),
    pollCursor: jsonb("poll_cursor"),
    enterpriseSafe: boolean("enterprise_safe").notNull().default(false),
    enterpriseSafeReason: text("enterprise_safe_reason"),
    enterpriseSafeDeclaredAt: timestamp("enterprise_safe_declared_at", { withTimezone: true }),
    enterpriseSafeAutoDowngraded: boolean("enterprise_safe_auto_downgraded")
      .notNull()
      .default(false),
    // CR-35 (PERF-014): enterprise_safe routing filter has no dedicated composite index;
    // scan-all-active-mailboxes is fine at <20 mailboxes/workspace.
    status: text("status").default("active").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByUserId: text("archived_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    archiveReason: text("archive_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("mailbox_org_address_provider_uidx").on(
      table.organizationId,
      table.address,
      table.provider,
    ),
    index("mailbox_status_id_idx").on(table.status, table.id),
  ],
);
