CREATE TABLE "outreach_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text NOT NULL,
	"filename" text NOT NULL,
	"actor_id" text NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text NOT NULL,
	"link" text NOT NULL,
	"normalized_link" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"actor_id" text NOT NULL,
	"batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_creator_link_unique" UNIQUE("product","normalized_link")
);
--> statement-breakpoint
CREATE TABLE "outreach_mailboxes" (
	"address" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"error" text,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outreach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product" text NOT NULL,
	"creator_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"request_key" uuid,
	"parent_id" uuid,
	"mailbox" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"send_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempted_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"retry_approved" boolean DEFAULT false NOT NULL,
	"gmail_id" text,
	"thread_id" text,
	"message_id" text,
	"sent_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_message_request_unique" UNIQUE("product","actor_id","request_key"),
	CONSTRAINT "outreach_message_followup_unique" UNIQUE("parent_id"),
	CONSTRAINT "outreach_gmail_message_unique" UNIQUE("mailbox","gmail_id")
);
--> statement-breakpoint
CREATE TABLE "outreach_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_id" uuid NOT NULL,
	"gmail_id" text NOT NULL,
	"sender" text NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "outreach_reply_unique" UNIQUE("root_id","gmail_id")
);
--> statement-breakpoint
CREATE TABLE "outreach_unsubscribes" (
	"mailbox" text NOT NULL,
	"recipient" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_unsubscribes_mailbox_recipient_pk" PRIMARY KEY("mailbox","recipient")
);
--> statement-breakpoint
ALTER TABLE "outreach_batches" ADD CONSTRAINT "outreach_batches_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_creators" ADD CONSTRAINT "outreach_creators_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_creators" ADD CONSTRAINT "outreach_creators_batch_id_outreach_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."outreach_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_creator_id_outreach_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."outreach_creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_parent_id_outreach_messages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."outreach_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_replies" ADD CONSTRAINT "outreach_replies_root_id_outreach_messages_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."outreach_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_batch_product_idx" ON "outreach_batches" USING btree ("product","created_at");--> statement-breakpoint
CREATE INDEX "outreach_creator_product_idx" ON "outreach_creators" USING btree ("product","created_at");--> statement-breakpoint
CREATE INDEX "outreach_message_creator_idx" ON "outreach_messages" USING btree ("product","creator_id","created_at");--> statement-breakpoint
CREATE INDEX "outreach_message_queue_idx" ON "outreach_messages" USING btree ("mailbox","status","send_at");--> statement-breakpoint
CREATE INDEX "outreach_message_thread_sync_idx" ON "outreach_messages" USING btree ("mailbox","synced_at") WHERE "outreach_messages"."parent_id" is null and "outreach_messages"."thread_id" is not null;--> statement-breakpoint
CREATE INDEX "outreach_message_recipient_idx" ON "outreach_messages" USING btree ("mailbox","recipient");