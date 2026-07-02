CREATE TYPE "public"."crm_provider" AS ENUM('salesforce', 'hubspot');--> statement-breakpoint
CREATE TABLE "crm_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "crm_provider" NOT NULL,
	"nango_connection_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"field_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"model" text NOT NULL,
	"cursor" jsonb,
	"last_run_at" timestamp with time zone,
	"status" text DEFAULT 'idle' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_connection" ADD CONSTRAINT "crm_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_connection" ADD CONSTRAINT "crm_connection_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_connection_id_crm_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."crm_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_connection_org_provider_uidx" ON "crm_connection" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_connection_nango_connection_id_uidx" ON "crm_connection" USING btree ("nango_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_state_connection_model_uidx" ON "sync_state" USING btree ("connection_id","model");