CREATE TABLE "commit_l3_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"commit_id" integer NOT NULL,
	"l3_node_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "l1_tags_name_idx";--> statement-breakpoint
ALTER TABLE "commit_l3_links" ADD CONSTRAINT "commit_l3_links_commit_id_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_l3_links" ADD CONSTRAINT "commit_l3_links_l3_node_id_l3_nodes_id_fk" FOREIGN KEY ("l3_node_id") REFERENCES "public"."l3_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commit_l3_commit_id_idx" ON "commit_l3_links" USING btree ("commit_id");--> statement-breakpoint
CREATE INDEX "commit_l3_node_id_idx" ON "commit_l3_links" USING btree ("l3_node_id");--> statement-breakpoint
CREATE INDEX "projects_owner_id_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "projects_repo_url_idx" ON "projects" USING btree ("repo_url");--> statement-breakpoint
CREATE INDEX "commit_l2_commit_id_idx" ON "commit_l2_links" USING btree ("commit_id");--> statement-breakpoint
CREATE INDEX "commit_l2_node_id_idx" ON "commit_l2_links" USING btree ("l2_node_id");--> statement-breakpoint
CREATE INDEX "l2_nodes_name_idx" ON "l2_nodes" USING btree ("name");--> statement-breakpoint
CREATE INDEX "l2_nodes_content_hash_idx" ON "l2_nodes" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "l3_nodes_content_hash_idx" ON "l3_nodes" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "l3_nodes_source_commits_idx" ON "l3_nodes" USING gin ("source_commits");--> statement-breakpoint
CREATE INDEX "l3_nodes_introduced_in_commit_idx" ON "l3_nodes" USING btree ("introduced_in_commit");--> statement-breakpoint
CREATE INDEX "doc_project_id_idx" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "doc_l2_node_id_idx" ON "documents" USING btree ("l2_node_id");--> statement-breakpoint
CREATE INDEX "node_links_source_node_idx" ON "node_links" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX "node_links_target_node_idx" ON "node_links" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX "error_reports_project_id_idx" ON "error_reports" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "error_reports_job_id_idx" ON "error_reports" USING btree ("job_id");