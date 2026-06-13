import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { commitsTable } from "./commits";
import { l2NodesTable } from "./l2_nodes";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const commitL2LinksTable = pgTable("commit_l2_links", {
  id: serial("id").primaryKey(),
  commitHash: text("commit_hash")
    .notNull()
    .references(() => commitsTable.hash, { onDelete: "cascade" }),
  l2NodeId: integer("l2_node_id")
    .notNull()
    .references(() => l2NodesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCommitL2LinkSchema = createInsertSchema(commitL2LinksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCommitL2Link = z.infer<typeof insertCommitL2LinkSchema>;
export type CommitL2Link = typeof commitL2LinksTable.$inferSelect;
