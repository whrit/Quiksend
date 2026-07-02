import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";
import { prospect } from "./prospects.ts";

export const researchProfileStatusEnum = pgEnum("research_profile_status", [
  "pending",
  "ready",
  "error",
]);

export const valueProp = pgTable(
  "value_prop",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    tags: text("tags").array().notNull().default([]),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("value_prop_organization_id_idx").on(table.organizationId),
    index("value_prop_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

export const researchProfile = pgTable(
  "research_profile",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospect.id, { onDelete: "cascade" }),
    facts: jsonb("facts").notNull().default([]),
    sources: jsonb("sources").notNull().default([]),
    summary: text("summary"),
    embedding: vector("embedding", { dimensions: 1536 }),
    freshUntil: timestamp("fresh_until", { withTimezone: true }),
    status: researchProfileStatusEnum("status").default("pending").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("research_profile_org_prospect_uidx").on(table.organizationId, table.prospectId),
    index("research_profile_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export type ResearchFact = {
  claim: string;
  source_url: string;
  confidence: number;
};

export type ResearchSource = {
  url: string;
  title: string;
  published_at: string | null;
};
