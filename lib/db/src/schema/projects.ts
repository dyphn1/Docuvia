import { pgTable, text, serial, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "indexing",
  "paused",
  "error",
]);

export const vcsTypeEnum = pgEnum("vcs_type", ["git", "svn"]);

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  repoUrl: text("repo_url").notNull(),
  description: text("description"),
  status: projectStatusEnum("status").notNull().default("active"),
  vcsType: vcsTypeEnum("vcs_type").notNull().default("git"),
  svnUrl: text("svn_url"),
  lastGitIngestedAt: timestamp("last_git_ingested_at"),
  lastSvnRevision: integer("last_svn_revision"),
  lastAstIngestedAt: timestamp("last_ast_ingested_at"),
  ownerId: integer("owner_id").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateProjectSchema = insertProjectSchema.partial();
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
