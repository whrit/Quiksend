CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'dispatched', 'failed');--> statement-breakpoint
CREATE TABLE "event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_outbox_type_idempotency_idx" ON "event_outbox" USING btree ("event_type","idempotency_key");--> statement-breakpoint
CREATE INDEX "event_outbox_status_created_idx" ON "event_outbox" USING btree ("status","created_at");
--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD COLUMN "outbox_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_outbox_id_event_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."event_outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_outbox_endpoint_idx" ON "webhook_delivery" USING btree ("outbox_id","endpoint_id") WHERE "outbox_id" IS NOT NULL;
