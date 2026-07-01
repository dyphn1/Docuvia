import { pgTable, serial, integer, index } from "drizzle-orm/pg-core";
import { l2NodesTable } from "./l2_nodes";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const l2NodeL1TagsTable = pgTable(
  "l2_node_l1_tags",
  {
    id: serial("id").primaryKey(),
    l2NodeId: integer("l2_node_id")
      .notNull()
      .references(() => l2NodesTable.id, { onDelete: "cascade" }),
    l1TagId: integer("l1_tag_id").notNull(),
  },
  (table) => ({
    l2NodeIdx: index("l2_node_l1_tags_l2_node_id_idx").on(table.l2NodeId),
    l1TagIdx: index("l2_node_l1_tags_l1_tag_id_idx").on(table.l1TagId),
  })
);

export const insertL2NodeL1TagSchema = createInsertSchema(l2NodeL1TagsTable).omit({ id: true });
export const updateL2NodeL1TagSchema = insertL2NodeL1TagSchema.partial();
export type InsertL2NodeL1Tag = z.infer<typeof insertL2NodeL1TagSchema>;
export type L2NodeL1Tag = typeof l2NodeL1TagsTable.$inferSelect;
