import {
  boolean,
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
import { enrollment, sequenceStep } from "./sequences.ts";

export const researchProfileStatusEnum = pgEnum("research_profile_status", [
  "pending",
  "ready",
  "error",
]);

export const generationStatusEnum = pgEnum("generation_status", [
  "draft",
  "approved",
  "sent",
  "discarded",
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
    // HNSW is global; at very large multi-tenant scale consider partial indexes
    // per organization_id (PERF-021) or table partitioning by org.
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

export type GenerationCitedFact = {
  claim: string;
  source_url?: string;
};

export type GenerationPromptPayload = {
  system: string;
  user: string;
  researchSummary: string | null;
  valuePropIds: string[];
  stepId: string | null;
  variant: "A" | "B";
};

export const generation = pgTable(
  "generation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospect.id, { onDelete: "cascade" }),
    enrollmentId: uuid("enrollment_id").references(() => enrollment.id, { onDelete: "set null" }),
    stepId: uuid("step_id").references(() => sequenceStep.id, { onDelete: "set null" }),
    variant: text("variant").$type<"A" | "B">().default("A").notNull(),
    prompt: jsonb("prompt").$type<GenerationPromptPayload>().notNull(),
    model: text("model").notNull(),
    outputSubject: text("output_subject").notNull(),
    outputBodyMarkdown: text("output_body_markdown").notNull(),
    outputRationale: text("output_rationale").notNull(),
    citedFacts: jsonb("cited_facts").$type<GenerationCitedFact[]>().notNull().default([]),
    humanized: boolean("humanized").default(false).notNull(),
    status: generationStatusEnum("status").default("draft").notNull(),
    approvedByUserId: text("approved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("generation_org_prospect_created_idx").on(
      table.organizationId,
      table.prospectId,
      table.createdAt,
    ),
  ],
);
