import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

/**
 * Project Files — tracks source file hashes for incremental AST watching.
 *
 * Stores a content hash per file per project so the AST ingestion pipeline
 * can skip unchanged files on incremental scans (Sub-second Incremental Watch).
 */
export const projectFilesTable = pgTable(
  "project_files",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    contentHash: text("content_hash").notNull(),
    lastParsedAt: timestamp("last_parsed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    projectFileIdx: index("project_file_idx").on(table.projectId, table.filePath),
    projectIdx: index("project_files_project_idx").on(table.projectId),
  })
);

export const insertProjectFileSchema = createInsertSchema(projectFilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
export type ProjectFile = typeof projectFilesTable.$inferSelect;
