import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { commitsTable } from "./commits";
import { l2NodesTable } from "./l2-nodes";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const commitL2LinksTable = pgTable(
  "commit_l2_links",
  {
    id: serial("id").primaryKey(),
    commitId: integer("commit_id")
      .notNull()
      .references(() => commitsTable.id, { onDelete: "cascade" }),
    l2NodeId: integer("l2_node_id")
      .notNull()
      .references(() => l2NodesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    commitIdIdx: index("commit_l2_commit_id_idx").on(table.commitId),
    l2NodeIdIdx: index("commit_l2_node_id_idx").on(table.l2NodeId),
  })
);

export const insertCommitL2LinkSchema = createInsertSchema(commitL2LinksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCommitL2Link = z.infer<typeof insertCommitL2LinkSchema>;
export type CommitL2Link = typeof commitL2LinksTable.$inferSelect;
