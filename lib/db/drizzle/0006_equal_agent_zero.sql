ALTER TABLE "prompt_templates" ADD COLUMN "parent_template_id" integer;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;