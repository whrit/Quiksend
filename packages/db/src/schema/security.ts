import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
