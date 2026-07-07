import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { projectsTable } from "./projects.js";

export const promptTemplatesTable = sqliteTable(
  "prompt_templates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
    templateType: text("template_type")
      .$type<"l1_tagger" | "l2_extractor" | "l3_generator">()
      .notNull(),
    systemPrompt: text("system_prompt").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    parentTemplateId: integer("parent_template_id"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
    updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    projectIdIdx: index("prompt_templates_project_id_idx").on(table.projectId),
  })
);
