import { sqliteTable, integer, text, index } from "drizzle-orm/sqlite-core";
import { l2NodesTable } from "./l2-nodes.js";

export const nodeLinksTable = sqliteTable(
  "node_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceNodeId: integer("source_node_id")
      .notNull()
      .references(() => l2NodesTable.id, { onDelete: "cascade" }),
    targetNodeId: integer("target_node_id")
      .notNull()
      .references(() => l2NodesTable.id, { onDelete: "cascade" }),
    linkType: text("link_type").notNull().default("depends_on"),
    commitSha: text("commit_sha"),
    diffSummary: text("diff_summary"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    sourceNodeIdx: index("node_links_source_node_idx").on(table.sourceNodeId),
    targetNodeIdx: index("node_links_target_node_idx").on(table.targetNodeId),
  })
);
