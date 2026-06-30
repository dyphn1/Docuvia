import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { l2NodesTable } from "./l2_nodes";

export const commitsTable = pgTable(
  "commits",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    message: text("message").notNull(),
    author: text("author").notNull(),
    valid: boolean("valid").notNull().default(true),
    // @deprecated — replaced by commit_l2_links junction table (v2). Set to nullable; remove in v3.
    l2NodeId: integer("l2_node_id").references(() => l2NodesTable.id, { onDelete: "set null" }),
    revision: integer("revision"),
    vcsType: text("vcs_type").default("git"),
    diff: text("diff"),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    branchName: text("branch_name"),
    validityStatus: text("validity_status").notNull().default("pending"),
  },
  (table) => [
    index("commits_project_id_idx").on(table.projectId),
    index("commits_l2_node_id_idx").on(table.l2NodeId),
  ]
);

export const insertCommitSchema = createInsertSchema(commitsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCommit = z.infer<typeof insertCommitSchema>;
export type Commit = typeof commitsTable.$inferSelect;
