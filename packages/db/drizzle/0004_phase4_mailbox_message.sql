CREATE TYPE "public"."mailbox_provider" AS ENUM('gmail', 'microsoft', 'smtp');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TABLE "mailbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"provider" "mailbox_provider" NOT NULL,
	"address" text NOT NULL,
	"display_name" text,
	"from_name" text,
	"nango_connection_id" text,
	"smtp_config" jsonb,
	"daily_cap" integer DEFAULT 50 NOT NULL,
	"send_window" jsonb DEFAULT '{"timezone":"UTC","window":{"mon":[[9,17]],"tue":[[9,17]],"wed":[[9,17]],"thu":[[9,17]],"fri":[[9,17]]}}'::jsonb NOT NULL,
	"throttle_seconds" integer DEFAULT 90 NOT NULL,
	"signature_html" text,
	"spf_ok" boolean,
	"dkim_ok" boolean,
	"dmarc_ok" boolean,
	"health_checked_at" timestamp with time zone,
	"health_notes" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_org_address_provider_uidx" UNIQUE("organization_id","address","provider")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"prospect_id" uuid,
	"enrollment_id" uuid,
	"direction" "message_direction" DEFAULT 'outbound' NOT NULL,
	"subject" text,
	"body_html" text,
	"body_text" text,
	"message_id_header" text,
	"provider_message_id" text,
	"provider_thread_id" text,
	"in_reply_to" text,
	"references_header" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"bounce_type" text,
	"dsn" jsonb,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_mailbox_list_idx" ON "message" USING btree ("organization_id","mailbox_id","direction","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_id_header_idx" ON "message" USING btree ("message_id_header");--> statement-breakpoint
CREATE INDEX "message_provider_thread_idx" ON "message" USING btree ("provider_thread_id");--> statement-breakpoint
CREATE INDEX "message_prospect_idx" ON "message" USING btree ("organization_id","prospect_id");