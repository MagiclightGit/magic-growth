CREATE TABLE "research_conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"question" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"answer" text,
	"error" text,
	"generation" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "research_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"product" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"title" text NOT NULL,
	"context" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_shared_supplements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid NOT NULL,
	"product" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"author_id" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_conversation_events" ADD CONSTRAINT "research_conversation_events_turn_id_research_conversation_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."research_conversation_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_conversation_turns" ADD CONSTRAINT "research_conversation_turns_conversation_id_research_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."research_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_conversations" ADD CONSTRAINT "research_conversations_owner_id_auth_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_conversations" ADD CONSTRAINT "research_conversations_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_shared_supplements" ADD CONSTRAINT "research_shared_supplements_turn_id_research_conversation_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."research_conversation_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_shared_supplements" ADD CONSTRAINT "research_shared_supplements_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_shared_supplements" ADD CONSTRAINT "research_shared_supplements_author_id_auth_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_events_turn" ON "research_conversation_events" USING btree ("turn_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turn_once" ON "research_conversation_turns" USING btree ("conversation_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turn_order" ON "research_conversation_turns" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "conversation_turn_pending" ON "research_conversation_turns" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_create_once" ON "research_conversations" USING btree ("owner_id","request_id");--> statement-breakpoint
CREATE INDEX "conversation_owner_source" ON "research_conversations" USING btree ("owner_id","source_kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_share_once" ON "research_shared_supplements" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "supplement_source" ON "research_shared_supplements" USING btree ("source_kind","source_id");