import { sqliteTable, integer, text, index } from "drizzle-orm/sqlite-core";
import { l2NodesTable } from "./l2-nodes.js";
import { l1TagsTable } from "./l1-tags.js";

export const l2NodeL1TagsTable = sqliteTable(
  "l2_node_l1_tags",
  {
    l2NodeId: integer("l2_node_id")
      .notNull()
      .references(() => l2NodesTable.id, { onDelete: "cascade" }),
    l1TagId: integer("l1_tag_id")
      .notNull()
      .references(() => l1TagsTable.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    l2NodeIdx: index("l2_node_l1_tags_l2_node_idx").on(table.l2NodeId),
    l1TagIdx: index("l2_node_l1_tags_l1_tag_idx").on(table.l1TagId),
  })
);
