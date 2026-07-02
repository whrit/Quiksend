import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Better Auth tables (user, session, account, verification, organization, member,
// invitation, apikey) — generated via `pnpm --filter @quiksend/auth auth:generate`.
export * from "./auth.ts";
export * from "./mail.ts";

/**
 * Baseline table so the first migration is non-empty and the migrate pipeline is
 * exercised end-to-end. Real domain tables (auth, mailboxes, sequences, ...) land
 * in later phases. `app_meta` is a simple key/value store for app-level flags,
 * schema markers, seed guards, etc.
 */
export * from "./prospects.ts";

export const appMeta = pgTable("app_meta", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export * from "./crm.ts";
export * from "./sequences.ts";
export * from "./ai.ts";
export * from "./tasks.ts";
export * from "./api.ts";
export * from "./writeback.ts";
export * from "./suppression.ts";
