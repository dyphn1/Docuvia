CREATE TYPE "public"."job_status" AS ENUM('pending', 'processing', 'failed', 'completed');--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"locked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"job_id" integer,
	"task_type" text NOT NULL,
	"error_message" text NOT NULL,
	"error_stack" text,
	"payload_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"file_path" text NOT NULL,
	"content_hash" text NOT NULL,
	"last_parsed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commit_l2_links" DROP CONSTRAINT "commit_l2_links_commit_l2_unique";--> statement-breakpoint
DROP INDEX "idx_commit_l2_links_commit";--> statement-breakpoint
DROP INDEX "idx_commit_l2_links_l2";--> statement-breakpoint
ALTER TABLE "l2_nodes" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);--> statement-breakpoint
ALTER TABLE "l3_nodes" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);--> statement-breakpoint
ALTER TABLE "l3_nodes" ALTER COLUMN "source_commits" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "l3_nodes" ALTER COLUMN "source_commits" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_ast_ingested_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "l2_nodes" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "l3_nodes" ADD COLUMN "introduced_in_commit" text;--> statement-breakpoint
ALTER TABLE "l3_nodes" ADD COLUMN "verified_until_commit" text;--> statement-breakpoint
ALTER TABLE "l3_nodes" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "commits" ADD COLUMN "diff" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "validity_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "uploaded_by" integer;--> statement-breakpoint
ALTER TABLE "node_links" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "node_links" ADD COLUMN "diff_summary" text;--> statement-breakpoint
ALTER TABLE "error_reports" ADD CONSTRAINT "error_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_reports" ADD CONSTRAINT "error_reports_job_id_job_queue_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_queue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_file_idx" ON "project_files" USING btree ("project_id","file_path");--> statement-breakpoint
CREATE INDEX "project_files_project_idx" ON "project_files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "l1_tags_category_idx" ON "l1_tags" USING btree ("category");--> statement-breakpoint
CREATE INDEX "l1_tags_name_idx" ON "l1_tags" USING btree ("name");--> statement-breakpoint
CREATE INDEX "l2_node_l1_tags_l2_node_id_idx" ON "l2_node_l1_tags" USING btree ("l2_node_id");--> statement-breakpoint
CREATE INDEX "l2_node_l1_tags_l1_tag_id_idx" ON "l2_node_l1_tags" USING btree ("l1_tag_id");--> statement-breakpoint
CREATE INDEX "l2_nodes_embedding_idx" ON "l2_nodes" USING ivfflat ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "l2_nodes_project_id_idx" ON "l2_nodes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "l3_nodes_embedding_idx" ON "l3_nodes" USING ivfflat ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "l3_nodes_l2_node_id_idx" ON "l3_nodes" USING btree ("l2_node_id");--> statement-breakpoint
CREATE INDEX "commits_project_id_idx" ON "commits" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "commits_l2_node_id_idx" ON "commits" USING btree ("l2_node_id");--> statement-breakpoint
CREATE INDEX "doc_content_hash_idx" ON "documents" USING btree ("content_hash");--> statement-breakpoint
ALTER TABLE "commit_l2_links" DROP COLUMN "diff_paths";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "commit_sha";