CREATE TABLE "intelligence_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"intelligence_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intelligence_id" uuid NOT NULL,
	"run_id" uuid,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"workflow_version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "research_extractions_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intelligence_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"assignee_id" text NOT NULL,
	"product" text NOT NULL,
	"market" text NOT NULL,
	"due_at" timestamp with time zone,
	"priority" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intelligence" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ADD CONSTRAINT "intelligence_candidates_extraction_id_research_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."research_extractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ADD CONSTRAINT "intelligence_candidates_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ADD CONSTRAINT "intelligence_candidates_intelligence_id_intelligence_id_fk" FOREIGN KEY ("intelligence_id") REFERENCES "public"."intelligence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_candidates" ADD CONSTRAINT "intelligence_candidates_reviewed_by_auth_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_evidence" ADD CONSTRAINT "intelligence_evidence_intelligence_id_intelligence_id_fk" FOREIGN KEY ("intelligence_id") REFERENCES "public"."intelligence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_evidence" ADD CONSTRAINT "intelligence_evidence_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_extractions" ADD CONSTRAINT "research_extractions_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_extractions" ADD CONSTRAINT "research_extractions_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_intelligence_id_intelligence_id_fk" FOREIGN KEY ("intelligence_id") REFERENCES "public"."intelligence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assignee_id_auth_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_extraction_position" ON "intelligence_candidates" USING btree ("extraction_id","position");--> statement-breakpoint
CREATE INDEX "candidate_status_idx" ON "intelligence_candidates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_item_url" ON "intelligence_evidence" USING btree ("intelligence_id","canonical_url");--> statement-breakpoint
CREATE INDEX "extraction_status_idx" ON "research_extractions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "task_item_kind" ON "workflow_tasks" USING btree ("intelligence_id","kind");--> statement-breakpoint
CREATE INDEX "task_status_idx" ON "workflow_tasks" USING btree ("status");