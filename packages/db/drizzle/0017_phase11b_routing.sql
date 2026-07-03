ALTER TABLE "send_reservation" ADD COLUMN "recipient_domain" text;--> statement-breakpoint
CREATE INDEX "send_reservation_mailbox_domain_reserved_idx" ON "send_reservation" USING btree ("mailbox_id","recipient_domain","reserved_at");
