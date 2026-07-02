CREATE TYPE "public"."writeback_event_type" AS ENUM('activity_log', 'contact_upsert', 'status_update');--> statement-breakpoint
CREATE TYPE "public"."writeback_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "crm_writeback_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"crm_connection_id" uuid,
	"event_type" "writeback_event_type" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"crm_external_id" text,
	"idempotency_key" text NOT NULL,
	"status" "writeback_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_attempted_at" timestamp with time zone,
	"payload" jsonb,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_writeback_log" ADD CONSTRAINT "crm_writeback_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_writeback_log" ADD CONSTRAINT "crm_writeback_log_crm_connection_id_crm_connection_id_fk" FOREIGN KEY ("crm_connection_id") REFERENCES "public"."crm_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_writeback_log_idempotency_uidx" ON "crm_writeback_log" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "crm_writeback_log_org_entity_idx" ON "crm_writeback_log" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "event_org_type_created_idx" ON "event" USING btree ("organization_id","type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE VIEW "public"."sequence_stats" AS (
  SELECT
    e.organization_id,
    e.sequence_id,
    COUNT(*)::int AS enrolled_count,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM message m
      WHERE m.enrollment_id = e.id
        AND m.organization_id = e.organization_id
        AND m.direction = 'outbound'
        AND m.status = 'sent'
    ))::int AS sent_count,
    COUNT(*) FILTER (WHERE e.state = 'replied')::int AS replied_count,
    COUNT(*) FILTER (WHERE e.state = 'bounced')::int AS bounced_count,
    COUNT(*) FILTER (WHERE e.state = 'completed')::int AS completed_count,
    COUNT(*) FILTER (WHERE e.state IN ('active', 'waiting', 'waiting_manual', 'paused'))::int AS active_count
  FROM enrollment e
  GROUP BY e.organization_id, e.sequence_id
);