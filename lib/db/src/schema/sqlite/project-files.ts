import { sqliteTable, integer, text, index, unique } from "drizzle-orm/sqlite-core";
import { projectsTable } from "./projects.js";

export const projectFilesTable = sqliteTable(
  "project_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    contentHash: text("content_hash"),
    lastParsedAt: text("last_parsed_at").default("CURRENT_TIMESTAMP"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    projectFilePathUnique: unique("project_files_project_id_file_path_unique").on(
      table.projectId,
      table.filePath
    ),
    projectIdx: index("project_files_project_id_idx").on(table.projectId),
  })
);
