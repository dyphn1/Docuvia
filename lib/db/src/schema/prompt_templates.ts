import { pgTable, text, serial, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const promptTemplateTypeEnum = pgEnum("prompt_template_type", [
  "l1_tagger",
  "l2_extractor",
  "l3_generator",
]);

export const promptTemplatesTable = pgTable("prompt_templates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  templateType: promptTemplateTypeEnum("template_type").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPromptTemplateSchema = createInsertSchema(promptTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updatePromptTemplateSchema = insertPromptTemplateSchema.partial();
export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;
export type PromptTemplate = typeof promptTemplatesTable.$inferSelect;


export const DEFAULT_PROMPT_TEMPLATES = [
  {
    templateType: "l1_tagger",
    systemPrompt: "You are an expert system tagger. Categorize the given code into high-level architecture tags.",
    isActive: true,
  },
  {
    templateType: "l2_extractor",
    systemPrompt: "You are an expert code analyst. Extract L2 module boundaries from the following commits.",
    isActive: true,
  },
  {
    templateType: "l3_generator",
    systemPrompt: "You are a senior architect. Generate L3 knowledge graph nodes documenting the decisions made in the following code.",
    isActive: true,
  }
];
