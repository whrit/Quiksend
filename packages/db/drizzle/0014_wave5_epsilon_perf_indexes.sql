CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX "send_reservation_mailbox_window_idx";--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "thread_at" timestamp with time zone GENERATED ALWAYS AS (coalesce("message"."received_at", "message"."sent_at")) STORED;--> statement-breakpoint
CREATE INDEX "mailbox_status_id_idx" ON "mailbox" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "message_enrollment_id_idx" ON "message" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "message_mailbox_throttle_idx" ON "message" USING btree ("mailbox_id","sent_at" DESC NULLS LAST) WHERE "message"."direction" = 'outbound' AND "message"."status" = 'sent';--> statement-breakpoint
CREATE INDEX "message_org_thread_at_idx" ON "message" USING btree ("organization_id","thread_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "company_name_trgm_idx" ON "company" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "prospect_org_created_idx" ON "prospect" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "prospect"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "prospect_email_trgm_idx" ON "prospect" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "prospect_first_name_trgm_idx" ON "prospect" USING gin ("first_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "prospect_last_name_trgm_idx" ON "prospect" USING gin ("last_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "enrollment_active_next_run_idx" ON "enrollment" USING btree ("state","next_run_at") WHERE "enrollment"."state" = 'active' AND "enrollment"."next_run_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "enrollment_org_sequence_idx" ON "enrollment" USING btree ("organization_id","sequence_id");--> statement-breakpoint
CREATE INDEX "enrollment_org_state_idx" ON "enrollment" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "send_reservation_mailbox_reserved_idx" ON "send_reservation" USING btree ("mailbox_id","reserved_at");--> statement-breakpoint
CREATE INDEX "event_org_entity_created_idx" ON "event" USING btree ("organization_id","entity_id","created_at" DESC NULLS LAST);