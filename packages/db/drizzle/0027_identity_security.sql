CREATE TABLE "organization_limit" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"deliverability_pro_until" timestamp with time zone,
	"mailbox_limit" integer DEFAULT 5 NOT NULL,
	"api_requests_per_day" integer DEFAULT 10000 NOT NULL,
	"ai_research_per_month" integer DEFAULT 1000 NOT NULL,
	"dns_checks_per_day" integer DEFAULT 5000 NOT NULL,
	"import_rows_per_job" integer DEFAULT 5000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_usage" (
	"organization_id" text NOT NULL,
	"resource" text NOT NULL,
	"period" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_usage_organization_id_resource_period_pk" PRIMARY KEY("organization_id","resource","period")
);
--> statement-breakpoint
ALTER TABLE "enrollment" DROP CONSTRAINT "enrollment_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "enrollment" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_limit" ADD CONSTRAINT "organization_limit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_usage" ADD CONSTRAINT "organization_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_usage_org_idx" ON "organization_usage" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
