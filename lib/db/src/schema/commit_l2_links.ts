import {
  pgTable,
  serial,
  integer,
  jsonb,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { commitsTable } from "./commits";
import { l2NodesTable } from "./l2_nodes";

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
    diffPaths: jsonb("diff_paths"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("commit_l2_links_commit_l2_unique").on(table.commitId, table.l2NodeId),
    index("idx_commit_l2_links_commit").on(table.commitId),
    index("idx_commit_l2_links_l2").on(table.l2NodeId),
  ],
);

export const insertCommitL2LinkSchema = createInsertSchema(commitL2LinksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCommitL2Link = z.infer<typeof insertCommitL2LinkSchema>;
export type CommitL2Link = typeof commitL2LinksTable.$inferSelect;
