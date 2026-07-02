CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."research_profile_status" AS ENUM('pending', 'ready', 'error');--> statement-breakpoint
CREATE TABLE "research_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"prospect_id" uuid NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"embedding" vector(1536),
	"fresh_until" timestamp with time zone,
	"status" "research_profile_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "value_prop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"embedding" vector(1536),
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_profile" ADD CONSTRAINT "research_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_profile" ADD CONSTRAINT "research_profile_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_prop" ADD CONSTRAINT "value_prop_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_prop" ADD CONSTRAINT "value_prop_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_profile_org_prospect_uidx" ON "research_profile" USING btree ("organization_id","prospect_id");--> statement-breakpoint
CREATE INDEX "research_profile_embedding_hnsw_idx" ON "research_profile" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "value_prop_organization_id_idx" ON "value_prop" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "value_prop_embedding_hnsw_idx" ON "value_prop" USING hnsw ("embedding" vector_cosine_ops);