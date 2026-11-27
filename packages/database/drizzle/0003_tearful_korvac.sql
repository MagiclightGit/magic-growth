CREATE TABLE "opportunity_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid,
	"intelligence_id" uuid,
	"version" text NOT NULL,
	"fingerprint" text NOT NULL,
	"input" jsonb NOT NULL,
	"proposal" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "assessment_one_target" CHECK (("opportunity_assessments"."candidate_id" IS NOT NULL)::int + ("opportunity_assessments"."intelligence_id" IS NOT NULL)::int = 1)
);
--> statement-breakpoint
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_candidate_id_intelligence_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."intelligence_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_intelligence_id_intelligence_id_fk" FOREIGN KEY ("intelligence_id") REFERENCES "public"."intelligence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_candidate_input" ON "opportunity_assessments" USING btree ("candidate_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_intelligence_input" ON "opportunity_assessments" USING btree ("intelligence_id","fingerprint");--> statement-breakpoint
CREATE INDEX "assessment_status_idx" ON "opportunity_assessments" USING btree ("status");