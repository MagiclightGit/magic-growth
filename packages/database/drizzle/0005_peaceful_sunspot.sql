ALTER TABLE "intelligence" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "intelligence" ADD COLUMN "owner_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence" ADD CONSTRAINT "intelligence_owner_id_auth_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intelligence_owner_idx" ON "intelligence" USING btree ("owner_id");