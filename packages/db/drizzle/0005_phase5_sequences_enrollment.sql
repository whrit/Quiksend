CREATE TYPE "public"."sequence_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sequence_step_type" AS ENUM('manual_email', 'auto_email', 'wait', 'task');--> statement-breakpoint
CREATE TABLE "enrollment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"sequence_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone,
	"anchor_message_id" text,
	"anchor_thread_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" text,
	"ab_bucket" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "sequence_status" DEFAULT 'draft' NOT NULL,
	"settings" jsonb DEFAULT '{"timezone":"UTC","throttle_seconds":90,"mailbox_ids":[],"stop_on_reply":true,"business_days_only":true}'::jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"step_index" integer NOT NULL,
	"step_type" "sequence_step_type" NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"business_days_only" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"variant_b" jsonb,
	"entry_condition" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_step" ADD CONSTRAINT "sequence_step_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_step" ADD CONSTRAINT "sequence_step_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_org_sequence_prospect_uidx" ON "enrollment" USING btree ("organization_id","sequence_id","prospect_id");--> statement-breakpoint
CREATE INDEX "enrollment_state_next_run_idx" ON "enrollment" USING btree ("state","next_run_at");--> statement-breakpoint
CREATE INDEX "enrollment_org_prospect_idx" ON "enrollment" USING btree ("organization_id","prospect_id");--> statement-breakpoint
CREATE INDEX "sequence_organization_id_idx" ON "sequence" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_step_sequence_index_uidx" ON "sequence_step" USING btree ("sequence_id","step_index");--> statement-breakpoint
CREATE INDEX "sequence_step_org_sequence_idx" ON "sequence_step" USING btree ("organization_id","sequence_id");