CREATE TABLE "product_members" (
	"product_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "product_members_product_id_user_id_pk" PRIMARY KEY("product_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "product_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "product" text;--> statement-breakpoint
ALTER TABLE "research_schedules" ADD COLUMN "product" text;--> statement-breakpoint
ALTER TABLE "product_members" ADD CONSTRAINT "product_members_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_members" ADD CONSTRAINT "product_members_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_member_user_idx" ON "product_members" USING btree ("user_id");--> statement-breakpoint
-- Existing product strings become catalog entries before foreign keys are enforced.
INSERT INTO products (id, name) SELECT DISTINCT product, product FROM intelligence ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO products (id, name) SELECT DISTINCT product, product FROM workflow_tasks ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO products (id, name) SELECT DISTINCT payload->>'product', payload->>'product' FROM intelligence_candidates WHERE payload->>'product' IS NOT NULL ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO products (id, name) VALUES ('MagicTattoo','MagicTattoo'), ('MagicLight','MagicLight') ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Preserve existing members' access only to the two previously shared products.
INSERT INTO product_members (product_id,user_id) SELECT p.id,u.id FROM products p CROSS JOIN auth_user u WHERE p.id IN ('MagicTattoo','MagicLight') AND u.role <> 'admin';
--> statement-breakpoint
-- Only infer report ownership when all its saved candidates agree. Other legacy reports stay admin-only.
UPDATE research_runs r SET product = x.product FROM (SELECT run_id, min(payload->>'product') AS product FROM intelligence_candidates GROUP BY run_id HAVING count(DISTINCT payload->>'product') = 1) x WHERE r.id=x.run_id;
--> statement-breakpoint
-- Legacy schedules have no reliable product. Keep them paused until explicitly associated.
UPDATE research_schedules SET enabled=false WHERE product IS NULL;
--> statement-breakpoint
ALTER TABLE "intelligence" ADD CONSTRAINT "intelligence_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_schedules" ADD CONSTRAINT "research_schedules_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_product_products_id_fk" FOREIGN KEY ("product") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;