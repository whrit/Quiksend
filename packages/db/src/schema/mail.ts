import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth.ts";
import { mailbox } from "./mailbox.ts";
import { prospect } from "./prospects.ts";
import { enrollment } from "./sequences.ts";

export { mailbox, mailboxProviderEnum } from "./mailbox.ts";

export const messageDirectionEnum = pgEnum("message_direction", ["outbound", "inbound"]);
export const messageSentimentEnum = pgEnum("message_sentiment", [
  "interested",
  "not_now",
  "objection",
  "out_of_office",
  "unsubscribe_request",
]);

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
    prospectId: uuid("prospect_id").references(() => prospect.id, { onDelete: "set null" }),
    enrollmentId: uuid("enrollment_id").references(() => enrollment.id, { onDelete: "set null" }),
    /**
     * Sequence step this message was sent for, captured at send time.
     *
     * Per-step analytics cannot use `enrollment.currentStepIndex` — that is the
     * enrollment's position *now*, so every message an enrollment ever sent gets
     * attributed to whatever step it later advanced to. Null for inbound mail,
     * manual compose/replies, and rows written before this column existed
     * (historical step attribution is not recoverable: manual sends also carry
     * an enrollmentId, so ordering by sentAt cannot distinguish them).
     */
    sequenceStepIndex: integer("sequence_step_index"),
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
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    metadataReconciledAt: timestamp("metadata_reconciled_at", { withTimezone: true }),
    reconciliationError: text("reconciliation_error"),
    ingestionAttempts: integer("ingestion_attempts"),
    ingestionComplete: boolean("ingestion_complete").default(false).notNull(),
    sentiment: messageSentimentEnum("sentiment"),
    bounceType: text("bounce_type"),
    dsn: jsonb("dsn"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    threadAt: timestamp("thread_at", { withTimezone: true }).generatedAlwaysAs(
      (): SQL => sql`coalesce(${message.receivedAt}, ${message.sentAt})`,
    ),
    isAutoReply: boolean("is_auto_reply").default(false).notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    error: text("error"),
    idempotencyKey: text("idempotency_key").unique(),
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
    index("message_inbox_list_idx").on(
      table.organizationId,
      table.direction,
      table.receivedAt.desc(),
    ),
    index("message_org_status_idx").on(table.organizationId, table.status),
    index("message_enrollment_id_idx").on(table.enrollmentId),
    index("message_mailbox_throttle_idx")
      .on(table.mailboxId, table.sentAt.desc())
      .where(sql`${table.direction} = 'outbound' AND ${table.status} = 'sent'`),
    uniqueIndex("message_mailbox_provider_msg_uidx")
      .on(table.mailboxId, table.providerMessageId)
      .where(sql`${table.direction} = 'inbound' AND ${table.providerMessageId} IS NOT NULL`),
    index("message_org_thread_at_idx").on(table.organizationId, table.threadAt.desc()),
    index("message_org_thread_auto_reply_idx").on(
      table.organizationId,
      table.providerThreadId,
      table.isAutoReply,
    ),
    // Per-step analytics rollup: group outbound sends by sequence step.
    index("message_enrollment_step_idx").on(
      table.organizationId,
      table.enrollmentId,
      table.sequenceStepIndex,
    ),
  ],
);
