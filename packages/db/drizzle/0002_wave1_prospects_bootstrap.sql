-- Wave 1 bootstrap: Track 2 prospect/company tables required by Phase 3 CRM upsert.
-- When Track 2 merges, reconcile migration numbering; this file may be dropped.
DO $$ BEGIN
  CREATE TYPE "public"."prospect_status" AS ENUM('new', 'active', 'replied', 'bounced', 'unsubscribed', 'do_not_contact');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."prospect_source" AS ENUM('manual', 'csv', 'crm', 'api');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text,
	"domain" text,
	"industry" text,
	"size" integer,
	"website" text,
	"linkedin_url" text,
	"custom_fields" jsonb,
	"crm_provider" text,
	"crm_external_id" text,
	"crm_connection_id" uuid,
	"last_crm_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" uuid,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"linkedin_url" text,
	"phone" text,
	"timezone" text,
	"status" "prospect_status" DEFAULT 'new' NOT NULL,
	"source" "prospect_source" DEFAULT 'manual' NOT NULL,
	"custom_fields" jsonb,
	"crm_provider" text,
	"crm_external_id" text,
	"crm_connection_id" uuid,
	"last_crm_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "company" ADD CONSTRAINT "company_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "prospect" ADD CONSTRAINT "prospect_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "prospect" ADD CONSTRAINT "prospect_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_org_domain_uidx" ON "company" USING btree ("organization_id","domain") WHERE "domain" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_org_crm_external_uidx" ON "company" USING btree ("organization_id","crm_provider","crm_external_id") WHERE "crm_external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospect_org_email_uidx" ON "prospect" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospect_org_crm_external_uidx" ON "prospect" USING btree ("organization_id","crm_provider","crm_external_id") WHERE "crm_external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospect_org_status_idx" ON "prospect" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospect_org_company_idx" ON "prospect" USING btree ("organization_id","company_id");
