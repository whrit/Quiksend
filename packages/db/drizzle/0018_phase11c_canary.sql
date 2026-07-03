CREATE TABLE "seed_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"email" text NOT NULL,
	"gateway" "gateway_type" NOT NULL,
	"provider" text NOT NULL,
	"imap_config" text NOT NULL,
	"verified_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"pool_tag" "seed_inbox_pool_tag",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canary_send" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"sequence_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"mailbox_id" uuid NOT NULL,
	"seed_inbox_id" uuid NOT NULL,
	"canary_token" uuid NOT NULL,
	"subject" text NOT NULL,
	"sent_at" timestamp with time zone,
	"expected_arrival_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"arrival_gateway_headers" jsonb,
	"arrival_folder" text,
	"arrival_status" "canary_arrival_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverability_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"gateway" "gateway_type" NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"canary_total" integer DEFAULT 0 NOT NULL,
	"canary_delivered" integer DEFAULT 0 NOT NULL,
	"canary_spam" integer DEFAULT 0 NOT NULL,
	"canary_quarantine" integer DEFAULT 0 NOT NULL,
	"canary_silent_dropped" integer DEFAULT 0 NOT NULL,
	"deliverability_pct" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "canary_config" jsonb;
--> statement-breakpoint
ALTER TABLE "seed_inbox" ADD CONSTRAINT "seed_inbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "canary_send" ADD CONSTRAINT "canary_send_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "canary_send" ADD CONSTRAINT "canary_send_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "canary_send" ADD CONSTRAINT "canary_send_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollment"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "canary_send" ADD CONSTRAINT "canary_send_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "canary_send" ADD CONSTRAINT "canary_send_seed_inbox_id_seed_inbox_id_fk" FOREIGN KEY ("seed_inbox_id") REFERENCES "public"."seed_inbox"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deliverability_snapshot" ADD CONSTRAINT "deliverability_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deliverability_snapshot" ADD CONSTRAINT "deliverability_snapshot_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "seed_inbox_org_idx" ON "seed_inbox" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "seed_inbox_gateway_active_idx" ON "seed_inbox" USING btree ("gateway","active");
--> statement-breakpoint
CREATE UNIQUE INDEX "seed_inbox_email_uidx" ON "seed_inbox" USING btree ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX "canary_send_token_uidx" ON "canary_send" USING btree ("canary_token");
--> statement-breakpoint
CREATE INDEX "canary_send_org_sequence_idx" ON "canary_send" USING btree ("organization_id","sequence_id");
--> statement-breakpoint
CREATE INDEX "canary_send_pending_idx" ON "canary_send" USING btree ("arrival_status","expected_arrival_at") WHERE "canary_send"."arrival_status" = 'pending';
--> statement-breakpoint
CREATE INDEX "canary_send_seed_inbox_idx" ON "canary_send" USING btree ("seed_inbox_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "deliverability_snapshot_tuple_uidx" ON "deliverability_snapshot" USING btree ("organization_id","mailbox_id","gateway","window_start");
--> statement-breakpoint
CREATE INDEX "deliverability_snapshot_org_window_idx" ON "deliverability_snapshot" USING btree ("organization_id","window_start");
