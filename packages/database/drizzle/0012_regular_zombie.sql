ALTER TABLE "intelligence_candidates" ALTER COLUMN "extraction_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ALTER COLUMN "position" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ADD COLUMN "manual_source_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_manual_source_unique" ON "intelligence_candidates" USING btree (("payload"->>'product'),"manual_source_key");--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ADD CONSTRAINT "candidate_research_origin" CHECK (("intelligence_candidates"."run_id" IS NULL) = ("intelligence_candidates"."extraction_id" IS NULL));