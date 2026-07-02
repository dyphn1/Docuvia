import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { projectsTable } from "./projects.js";

export const l2NodesTable = sqliteTable(
  "l2_nodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type")
      .$type<"package" | "module" | "pcd" | "sys-uncategorized">()
      .notNull()
      .default("module"),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    description: text("description"),
    aiGenerated: integer("ai_generated", { mode: "boolean" }).notNull().default(true),
    needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
    // vector omitted for sqlite
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
    lastVerifiedAt: text("last_verified_at").default("CURRENT_TIMESTAMP"),
    pathPatterns: text("path_patterns", { mode: "json" }),
    reindexRequired: integer("reindex_required", { mode: "boolean" }).notNull().default(false),
    isBootstrapConfirmed: integer("is_bootstrap_confirmed", { mode: "boolean" })
      .notNull()
      .default(false),
    contentHash: text("content_hash"),
  },
  (table) => ({
    l2ProjectIdx: index("l2_nodes_project_id_idx").on(table.projectId),
    nameIdx: index("l2_nodes_name_idx").on(table.name),
    contentHashIdx: index("l2_nodes_content_hash_idx").on(table.contentHash),
  })
);
