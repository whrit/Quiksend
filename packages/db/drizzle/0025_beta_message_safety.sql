ALTER TABLE "mailbox" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "archived_by_user_id" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "metadata_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "reconciliation_error" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "ingestion_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_archived_by_user_id_user_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_mailbox_provider_msg_uidx" ON "message" USING btree ("mailbox_id","provider_message_id") WHERE "message"."direction" = 'inbound' AND "message"."provider_message_id" IS NOT NULL;