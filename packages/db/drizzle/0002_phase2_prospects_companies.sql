CREATE TYPE "public"."prospect_source" AS ENUM('manual', 'csv', 'crm', 'api');--> statement-breakpoint
CREATE TYPE "public"."prospect_status" AS ENUM('new', 'active', 'replied', 'bounced', 'unsubscribed', 'do_not_contact');--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text,
	"domain" text,
	"industry" text,
	"size" text,
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
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"filename" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"errored_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_error" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect" (
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
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_error" ADD CONSTRAINT "import_error_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list" ADD CONSTRAINT "list_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list" ADD CONSTRAINT "list_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_member" ADD CONSTRAINT "list_member_list_id_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_member" ADD CONSTRAINT "list_member_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect" ADD CONSTRAINT "prospect_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect" ADD CONSTRAINT "prospect_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_organization_id_idx" ON "company" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_org_domain_uidx" ON "company" USING btree ("organization_id","domain") WHERE "company"."domain" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "company_org_crm_uidx" ON "company" USING btree ("organization_id","crm_provider","crm_external_id") WHERE "company"."crm_external_id" is not null;--> statement-breakpoint
CREATE INDEX "import_batch_organization_id_idx" ON "import_batch" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_error_batch_id_idx" ON "import_error" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "list_organization_id_idx" ON "list" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "list_member_list_prospect_uidx" ON "list_member" USING btree ("list_id","prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_org_email_uidx" ON "prospect" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "prospect_org_status_idx" ON "prospect" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "prospect_org_company_idx" ON "prospect" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_org_crm_uidx" ON "prospect" USING btree ("organization_id","crm_provider","crm_external_id") WHERE "prospect"."crm_external_id" is not null;