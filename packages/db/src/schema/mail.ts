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
export const messageDirectionEnum = pgEnum("message_direction", ["outbound", "inbound"]);

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
    status: text("status").default("active").notNull(),
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
  ],
);

export const message = pgTable(
  "message",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailbox.id, { onDelete: "cascade" }),
    // FK to prospect.id (ON DELETE SET NULL) — declared when Track 2's prospect table lands.
    prospectId: uuid("prospect_id"),
    enrollmentId: uuid("enrollment_id"),
    direction: messageDirectionEnum("direction").default("outbound").notNull(),
    subject: text("subject"),
    bodyHtml: text("body_html"),
    bodyText: text("body_text"),
    messageIdHeader: text("message_id_header"),
    providerMessageId: text("provider_message_id"),
    providerThreadId: text("provider_thread_id"),
    inReplyTo: text("in_reply_to"),
    referencesHeader: text("references_header"),
    status: text("status").default("sent").notNull(),
    bounceType: text("bounce_type"),
    dsn: jsonb("dsn"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("message_mailbox_list_idx").on(
      table.organizationId,
      table.mailboxId,
      table.direction,
      table.sentAt.desc(),
    ),
    index("message_id_header_idx").on(table.messageIdHeader),
    index("message_provider_thread_idx").on(table.providerThreadId),
    index("message_prospect_idx").on(table.organizationId, table.prospectId),
  ],
);
