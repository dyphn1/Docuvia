CREATE TYPE "public"."project_status" AS ENUM('active', 'indexing', 'paused', 'error');--> statement-breakpoint
CREATE TYPE "public"."vcs_type" AS ENUM('git', 'svn');--> statement-breakpoint
CREATE TYPE "public"."l2_node_type" AS ENUM('package', 'module', 'pcd', 'sys-uncategorized');--> statement-breakpoint
CREATE TYPE "public"."l3_node_type" AS ENUM('change', 'rule', 'decision', 'context');--> statement-breakpoint
CREATE TYPE "public"."review_entity_type" AS ENUM('l1_tag', 'l2_node', 'l3_node');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."review_task_type" AS ENUM('anchor', 'correct', 'validate', 'merge');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('commit', 'l2_created', 'l3_created', 'review_resolved', 'tag_added', 'document');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('markdown', 'txt', 'pdf', 'docx', 'pptx', 'build_artifact');--> statement-breakpoint
CREATE TYPE "public"."prompt_template_type" AS ENUM('l1_tagger', 'l2_extractor', 'l3_generator');--> statement-breakpoint
CREATE TYPE "public"."pr_analysis_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pr_state" AS ENUM('open', 'closed', 'merged');--> statement-breakpoint
CREATE TYPE "public"."integration_type" AS ENUM('slack', 'teams');--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"repo_url" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"vcs_type" "vcs_type" DEFAULT 'git' NOT NULL,
	"svn_url" text,
	"last_git_ingested_at" timestamp,
	"last_svn_revision" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "l1_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"is_anchored" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "l1_tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "commit_l2_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"commit_id" integer NOT NULL,
	"l2_node_id" integer NOT NULL,
	"diff_paths" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commit_l2_links_commit_l2_unique" UNIQUE("commit_id","l2_node_id")
);
--> statement-breakpoint
CREATE TABLE "l2_node_l1_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"l2_node_id" integer NOT NULL,
	"l1_tag_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "l2_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" "l2_node_type" DEFAULT 'module' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"description" text,
	"ai_generated" boolean DEFAULT true NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"embedding" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_verified_at" timestamp DEFAULT now(),
	"path_patterns" jsonb,
	"reindex_required" boolean DEFAULT false NOT NULL,
	"is_bootstrap_confirmed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "l3_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"l2_node_id" integer NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"node_type" "l3_node_type" DEFAULT 'change' NOT NULL,
	"commit_hash" text,
	"ai_generated" boolean DEFAULT true NOT NULL,
	"confidence" real,
	"noise_score" real,
	"embedding" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_verified_at" timestamp DEFAULT now(),
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"source_commits" jsonb,
	"validity_status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'commit' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"hash" text NOT NULL,
	"message" text NOT NULL,
	"author" text NOT NULL,
	"valid" boolean DEFAULT true NOT NULL,
	"l2_node_id" integer,
	"revision" integer,
	"vcs_type" text DEFAULT 'git',
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"branch_name" text,
	"validity_status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" "review_entity_type" NOT NULL,
	"entity_id" integer NOT NULL,
	"task_type" "review_task_type" NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"description" text,
	"corrected_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "activity_type" NOT NULL,
	"description" text NOT NULL,
	"project_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"l2_node_id" integer,
	"filename" text NOT NULL,
	"doc_type" "document_type" DEFAULT 'markdown' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"content_hash" text,
	"commit_sha" text,
	"affiliated_at" timestamp,
	"status" text DEFAULT 'unaffiliated' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_node_id" integer NOT NULL,
	"target_node_id" integer NOT NULL,
	"link_type" text DEFAULT 'depends_on' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"provider" text DEFAULT 'openai' NOT NULL,
	"model" text DEFAULT 'gpt-5.2' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"similarity_threshold" real DEFAULT 0.85 NOT NULL,
	"condensation_threshold" integer DEFAULT 30 NOT NULL,
	"condensation_review_required" boolean DEFAULT false NOT NULL,
	"auto_generate" boolean DEFAULT false NOT NULL,
	"max_commits_per_run" integer DEFAULT 50 NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"template_type" "prompt_template_type" NOT NULL,
	"system_prompt" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction_examples" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"original_content" text NOT NULL,
	"corrected_content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscriber_project_id" integer NOT NULL,
	"publisher_project_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_subscriber_project_id_publisher_project_id_unique" UNIQUE("subscriber_project_id","publisher_project_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"github_pr_number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"head_sha" text NOT NULL,
	"base_sha" text NOT NULL,
	"author" text NOT NULL,
	"state" "pr_state" DEFAULT 'open' NOT NULL,
	"url" text NOT NULL,
	"analysis_status" "pr_analysis_status" DEFAULT 'pending' NOT NULL,
	"ai_summary" text,
	"merged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"integration_type" "integration_type" NOT NULL,
	"webhook_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notification_types" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commit_l2_links" ADD CONSTRAINT "commit_l2_links_commit_id_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_l2_links" ADD CONSTRAINT "commit_l2_links_l2_node_id_l2_nodes_id_fk" FOREIGN KEY ("l2_node_id") REFERENCES "public"."l2_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "l2_node_l1_tags" ADD CONSTRAINT "l2_node_l1_tags_l2_node_id_l2_nodes_id_fk" FOREIGN KEY ("l2_node_id") REFERENCES "public"."l2_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "l2_nodes" ADD CONSTRAINT "l2_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "l3_nodes" ADD CONSTRAINT "l3_nodes_l2_node_id_l2_nodes_id_fk" FOREIGN KEY ("l2_node_id") REFERENCES "public"."l2_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_l2_node_id_l2_nodes_id_fk" FOREIGN KEY ("l2_node_id") REFERENCES "public"."l2_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_l2_node_id_l2_nodes_id_fk" FOREIGN KEY ("l2_node_id") REFERENCES "public"."l2_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_links" ADD CONSTRAINT "node_links_source_node_id_l2_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."l2_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_links" ADD CONSTRAINT "node_links_target_node_id_l2_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."l2_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_configs" ADD CONSTRAINT "llm_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_examples" ADD CONSTRAINT "correction_examples_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_subscriber_project_id_projects_id_fk" FOREIGN KEY ("subscriber_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_publisher_project_id_projects_id_fk" FOREIGN KEY ("publisher_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_commit_l2_links_commit" ON "commit_l2_links" USING btree ("commit_id");--> statement-breakpoint
CREATE INDEX "idx_commit_l2_links_l2" ON "commit_l2_links" USING btree ("l2_node_id");