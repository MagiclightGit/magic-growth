DROP INDEX "drama_product_source";--> statement-breakpoint
CREATE UNIQUE INDEX "drama_product_source" ON "dramas" USING btree ("product","canonical_url","title");