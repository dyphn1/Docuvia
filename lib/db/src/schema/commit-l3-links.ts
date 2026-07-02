import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { commitsTable } from "./commits";
import { l3NodesTable } from "./l3-nodes";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const commitL3LinksTable = pgTable("commit_l3_links", {
  id: serial("id").primaryKey(),
  commitId: integer("commit_id")
    .notNull()
    .references(() => commitsTable.id, { onDelete: "cascade" }),
  l3NodeId: integer("l3_node_id")
    .notNull()
    .references(() => l3NodesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCommitL3LinkSchema = createInsertSchema(commitL3LinksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCommitL3Link = z.infer<typeof insertCommitL3LinkSchema>;
export type CommitL3Link = typeof commitL3LinksTable.$inferSelect;
