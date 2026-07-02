CREATE TYPE "public"."suppression_reason" AS ENUM('bounce', 'unsubscribe', 'manual', 'complaint');--> statement-breakpoint
CREATE TYPE "public"."suppression_value_type" AS ENUM('email', 'domain');--> statement-breakpoint
CREATE TABLE "suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"value" text NOT NULL,
	"value_type" "suppression_value_type" DEFAULT 'email' NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source_message_id" uuid,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_org_value_uidx" UNIQUE("organization_id","value")
);
--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "poll_cursor" jsonb;--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_source_message_id_message_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suppression_org_reason_idx" ON "suppression" USING btree ("organization_id","reason");--> statement-breakpoint
CREATE INDEX "message_inbox_list_idx" ON "message" USING btree ("organization_id","direction","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_org_status_idx" ON "message" USING btree ("organization_id","status");