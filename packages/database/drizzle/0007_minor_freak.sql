CREATE TABLE "competitor_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watch_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"content" text,
	"previous_content" text,
	"change" text DEFAULT 'unknown' NOT NULL,
	"claim_type" text DEFAULT 'fact' NOT NULL,
	"method" text DEFAULT 'web' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"error" text,
	"source_url" text NOT NULL,
	"intelligence_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "competitor_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text NOT NULL,
	"name" text NOT NULL,
	"market" text NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"interval_hours" integer DEFAULT 24 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drama_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drama_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dramas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text NOT NULL,
	"title" text NOT NULL,
	"platform" text NOT NULL,
	"market" text NOT NULL,
	"data" jsonb NOT NULL,
	"canonical_url" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"intelligence_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_watch_id_competitor_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."competitor_watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_intelligence_id_intelligence_id_fk" FOREIGN KEY ("intelligence_id") REFERENCES "public"."intelligence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_watches" ADD CONSTRAINT "competitor_watches_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_watches" ADD CONSTRAINT "competitor_watches_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drama_observations" ADD CONSTRAINT "drama_observations_drama_id_dramas_id_fk" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drama_observations" ADD CONSTRAINT "drama_observations_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dramas" ADD CONSTRAINT "dramas_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dramas" ADD CONSTRAINT "dramas_intelligence_id_intelligence_id_fk" FOREIGN KEY ("intelligence_id") REFERENCES "public"."intelligence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dramas" ADD CONSTRAINT "dramas_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshot_watch_time_idx" ON "competitor_snapshots" USING btree ("watch_id","created_at");--> statement-breakpoint
CREATE INDEX "snapshot_status_idx" ON "competitor_snapshots" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_product_url_kind" ON "competitor_watches" USING btree ("product","canonical_url","kind");--> statement-breakpoint
CREATE INDEX "watch_due_idx" ON "competitor_watches" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "drama_observation_idx" ON "drama_observations" USING btree ("drama_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drama_product_source" ON "dramas" USING btree ("product","canonical_url");--> statement-breakpoint
CREATE INDEX "drama_product_time" ON "dramas" USING btree ("product","created_at");