CREATE TYPE "public"."canary_arrival_status" AS ENUM('pending', 'arrived_inbox', 'arrived_spam', 'arrived_quarantine', 'silent_drop', 'bounced');--> statement-breakpoint
CREATE TYPE "public"."gateway_type" AS ENUM('proofpoint', 'mimecast', 'barracuda', 'cisco_ironport', 'trend_micro', 'fortinet', 'sophos', 'symantec', 'google_workspace', 'microsoft_365', 'zoho', 'fastmail', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."seed_inbox_pool_tag" AS ENUM('production', 'canary_only', 'warmup');--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "enterprise_safe" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "enterprise_safe_reason" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "enterprise_safe_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "enterprise_safe_auto_downgraded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect" ADD COLUMN "email_gateway" "gateway_type";--> statement-breakpoint
ALTER TABLE "prospect" ADD COLUMN "gateway_classified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospect" ADD COLUMN "gateway_evidence" jsonb;--> statement-breakpoint
CREATE INDEX "prospect_org_gateway_idx" ON "prospect" USING btree ("organization_id","email_gateway") WHERE "prospect"."email_gateway" IS NOT NULL AND "prospect"."deleted_at" IS NULL;