import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { l2NodesTable } from "./l2_nodes";

export const nodeLinksTable = pgTable("node_links", {
  id: serial("id").primaryKey(),
  sourceNodeId: integer("source_node_id").notNull().references(() => l2NodesTable.id, { onDelete: "cascade" }),
  targetNodeId: integer("target_node_id").notNull().references(() => l2NodesTable.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull().default("depends_on"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertNodeLinkSchema = createInsertSchema(nodeLinksTable).omit({ id: true, createdAt: true });
export type InsertNodeLink = z.infer<typeof insertNodeLinkSchema>;
export type NodeLink = typeof nodeLinksTable.$inferSelect;
