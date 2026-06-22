import { pgTable, text, serial, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const prStateEnum = pgEnum("pr_state", ["open", "closed", "merged"]);
export const prAnalysisStatusEnum = pgEnum("pr_analysis_status", [
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

export const pullRequestsTable = pgTable("pull_requests", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  githubPrNumber: integer("github_pr_number").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  headSha: text("head_sha").notNull(),
  baseSha: text("base_sha").notNull(),
  author: text("author").notNull(),
  state: prStateEnum("state").notNull().default("open"),
  url: text("url").notNull(),
  analysisStatus: prAnalysisStatusEnum("analysis_status").notNull().default("pending"),
  aiSummary: text("ai_summary"),
  mergedAt: timestamp("merged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPullRequestSchema = createInsertSchema(pullRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPullRequest = z.infer<typeof insertPullRequestSchema>;
export type PullRequest = typeof pullRequestsTable.$inferSelect;
