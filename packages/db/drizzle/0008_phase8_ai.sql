CREATE TYPE "public"."generation_status" AS ENUM('draft', 'approved', 'sent', 'discarded');--> statement-breakpoint
CREATE TABLE "generation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"prospect_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"step_id" uuid,
	"variant" text DEFAULT 'A' NOT NULL,
	"prompt" jsonb NOT NULL,
	"model" text NOT NULL,
	"output_subject" text NOT NULL,
	"output_body_markdown" text NOT NULL,
	"output_rationale" text NOT NULL,
	"cited_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"humanized" boolean DEFAULT false NOT NULL,
	"status" "generation_status" DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_step_id_sequence_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_org_prospect_created_idx" ON "generation" USING btree ("organization_id","prospect_id","created_at");