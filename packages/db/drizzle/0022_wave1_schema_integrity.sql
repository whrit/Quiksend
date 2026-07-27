ALTER TABLE "message" ADD COLUMN "is_auto_reply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_prospect_id_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospect"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_org_thread_auto_reply_idx" ON "message" USING btree ("organization_id","provider_thread_id","is_auto_reply");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_idempotency_key_uidx" ON "enrollment" USING btree ("idempotency_key") WHERE "enrollment"."idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_state_check" CHECK ("enrollment"."state" IN ('active', 'waiting', 'waiting_manual', 'paused', 'stopped', 'completed', 'replied', 'bounced', 'failed'));