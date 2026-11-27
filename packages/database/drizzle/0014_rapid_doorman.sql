CREATE TABLE "collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"scheduled" boolean NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"discovered" integer,
	"added" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feed_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"product" text NOT NULL,
	"market" text NOT NULL,
	"vertical" text NOT NULL,
	"category" text NOT NULL,
	"interval_hours" integer NOT NULL,
	"permission_note" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ADD COLUMN "collection_run_id" uuid;--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ADD COLUMN "feed_item_key" text;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_source_id_feed_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."feed_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_sources" ADD CONSTRAINT "feed_sources_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_sources" ADD CONSTRAINT "feed_sources_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_source_history" ON "collection_runs" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_one_active_run" ON "collection_runs" USING btree ("source_id") WHERE "collection_runs"."status" in ('queued','running');--> statement-breakpoint
CREATE UNIQUE INDEX "feed_source_url_product" ON "feed_sources" USING btree ("product","canonical_url");--> statement-breakpoint
CREATE INDEX "feed_source_due" ON "feed_sources" USING btree ("next_run_at") WHERE "feed_sources"."enabled" = true;--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ADD CONSTRAINT "intelligence_candidates_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_feed_item_unique" ON "intelligence_candidates" USING btree (("payload"->>'product'),"feed_item_key");