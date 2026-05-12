import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
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
});

export const insertLlmConfigSchema = createInsertSchema(llmConfigsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLlmConfig = z.infer<typeof insertLlmConfigSchema>;
export type LlmConfig = typeof llmConfigsTable.$inferSelect;
