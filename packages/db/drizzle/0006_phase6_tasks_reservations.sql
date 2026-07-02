CREATE TYPE "public"."job_log_status" AS ENUM('started', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."send_reservation_status" AS ENUM('held', 'sent', 'released');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'done', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('compose', 'generic');--> statement-breakpoint
CREATE TABLE "job_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"payload_ref" text,
	"status" "job_log_status" NOT NULL,
	"attempt" integer NOT NULL,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "send_reservation" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"status" "send_reservation_status" DEFAULT 'held' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"step_id" uuid,
	"type" "task_type" NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"due_at" timestamp with time zone,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"assigned_user_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "send_reservation" ADD CONSTRAINT "send_reservation_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_reservation" ADD CONSTRAINT "send_reservation_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_step_id_sequence_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_log_payload_ref_created_idx" ON "job_log" USING btree ("payload_ref","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "send_reservation_mailbox_window_idx" ON "send_reservation" USING btree ("mailbox_id","window_start");--> statement-breakpoint
CREATE INDEX "task_org_status_due_idx" ON "task" USING btree ("organization_id","status","due_at");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_idempotency_key_unique" UNIQUE("idempotency_key");