CREATE TYPE "public"."gateway_classification_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "gateway_classification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_domain" text NOT NULL,
	"gateway" "gateway_type" NOT NULL,
	"mx_records" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"confidence" "gateway_classification_confidence" NOT NULL,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ttl_until" timestamp with time zone NOT NULL,
	CONSTRAINT "gateway_classification_email_domain_unique" UNIQUE("email_domain")
);
--> statement-breakpoint
CREATE INDEX "gateway_classification_gateway_idx" ON "gateway_classification" USING btree ("gateway");--> statement-breakpoint
CREATE INDEX "gateway_classification_ttl_idx" ON "gateway_classification" USING btree ("ttl_until");