ALTER TABLE "deliverability_snapshot" ADD COLUMN "window_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "deliverability_snapshot_tuple_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "deliverability_snapshot_tuple_uidx" ON "deliverability_snapshot" USING btree ("organization_id","mailbox_id","gateway","window_days","window_start");--> statement-breakpoint
CREATE INDEX "canary_send_pending_sent_at_idx" ON "canary_send" USING btree ("sent_at") WHERE "arrival_status" = 'pending' AND "sent_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "canary_send_sequence_mailbox_idx" ON "canary_send" USING btree ("sequence_id","mailbox_id");--> statement-breakpoint
CREATE INDEX "seed_inbox_org_active_idx" ON "seed_inbox" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "seed_inbox_provider_gateway_active_idx" ON "seed_inbox" USING btree ("gateway","active") WHERE "organization_id" IS NULL;
