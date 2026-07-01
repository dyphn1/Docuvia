import { pgTable, text, serial, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const llmConfigsTable = pgTable("llm_configs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("openai"),
  model: text("model").notNull().default("gpt-5.2"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  similarityThreshold: real("similarity_threshold").notNull().default(0.85),
  condensationThreshold: integer("condensation_threshold").notNull().default(30),
  condensationReviewRequired: boolean("condensation_review_required").notNull().default(false),
  autoGenerate: boolean("auto_generate").notNull().default(false),
  maxCommitsPerRun: integer("max_commits_per_run").notNull().default(50),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
});

export const insertLlmConfigSchema = createInsertSchema(llmConfigsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLlmConfig = z.infer<typeof insertLlmConfigSchema>;
export type LlmConfig = typeof llmConfigsTable.$inferSelect;
