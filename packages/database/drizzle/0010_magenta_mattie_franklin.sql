CREATE TABLE "competitor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text NOT NULL,
	"name" text NOT NULL,
	"website" text NOT NULL,
	"canonical_url" text NOT NULL,
	"market" text NOT NULL,
	"focus" text DEFAULT '' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interval_hours" integer DEFAULT 24 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_research_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_research_publications" (
	"run_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"intelligence_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'research' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"config" jsonb NOT NULL,
	"report" text,
	"findings" jsonb,
	"previous_run_id" uuid,
	"error" text,
	"model" text,
	"workflow_version" text DEFAULT 'competitor-research/v1' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "competitor_profiles" ADD CONSTRAINT "competitor_profiles_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_profiles" ADD CONSTRAINT "competitor_profiles_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_research_events" ADD CONSTRAINT "competitor_research_events_run_id_competitor_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."competitor_research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_research_publications" ADD CONSTRAINT "competitor_research_publications_run_id_competitor_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."competitor_research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_research_publications" ADD CONSTRAINT "competitor_research_publications_intelligence_id_intelligence_id_fk" FOREIGN KEY ("intelligence_id") REFERENCES "public"."intelligence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_research_runs" ADD CONSTRAINT "competitor_research_runs_competitor_id_competitor_profiles_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_research_runs" ADD CONSTRAINT "competitor_research_runs_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_product_website" ON "competitor_profiles" USING btree ("product","canonical_url");--> statement-breakpoint
CREATE INDEX "competitor_due" ON "competitor_profiles" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "competitor_events_run" ON "competitor_research_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_publication_once" ON "competitor_research_publications" USING btree ("run_id","dimension");--> statement-breakpoint
CREATE INDEX "competitor_run_history" ON "competitor_research_runs" USING btree ("competitor_id","created_at");--> statement-breakpoint
CREATE INDEX "competitor_run_pending" ON "competitor_research_runs" USING btree ("status");