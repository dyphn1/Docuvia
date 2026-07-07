ALTER TABLE "l1_tags" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "l1_tags" ADD CONSTRAINT "l1_tags_slug_unique" UNIQUE("slug");