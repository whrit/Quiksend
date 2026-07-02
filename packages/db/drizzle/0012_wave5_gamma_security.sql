CREATE TABLE "auth_rate_bucket" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nango_webhook_processed" (
	"event_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nango_webhook_processed_event_id_connection_id_pk" PRIMARY KEY("event_id","connection_id")
);
--> statement-breakpoint
CREATE INDEX "nango_webhook_processed_at" ON "nango_webhook_processed" USING btree ("processed_at");