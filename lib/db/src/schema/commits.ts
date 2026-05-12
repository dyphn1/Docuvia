import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { l2NodesTable } from "./l2_nodes";

export const commitsTable = pgTable("commits", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  hash: text("hash").notNull(),
  message: text("message").notNull(),
  author: text("author").notNull(),
  valid: boolean("valid").notNull().default(true),
  l2NodeId: integer("l2_node_id").references(() => l2NodesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCommitSchema = createInsertSchema(commitsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCommit = z.infer<typeof insertCommitSchema>;
export type Commit = typeof commitsTable.$inferSelect;
