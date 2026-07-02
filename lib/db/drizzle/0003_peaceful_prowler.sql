CREATE INDEX "llm_configs_project_id_idx" ON "llm_configs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "prompt_templates_project_id_idx" ON "prompt_templates" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "correction_examples_project_id_idx" ON "correction_examples" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "subscriptions_subscriber_project_id_idx" ON "subscriptions" USING btree ("subscriber_project_id");--> statement-breakpoint
CREATE INDEX "subscriptions_publisher_project_id_idx" ON "subscriptions" USING btree ("publisher_project_id");--> statement-breakpoint
CREATE INDEX "notifications_project_id_idx" ON "notifications" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pull_requests_project_id_idx" ON "pull_requests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_integrations_project_id_idx" ON "project_integrations" USING btree ("project_id");