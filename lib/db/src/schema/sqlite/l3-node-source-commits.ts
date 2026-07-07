import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { l3NodesTable } from "./l3-nodes.js";

/**
 * Junction table providing indexed lookup of L3 nodes by source commit hash.
 *
 * SQLite does not support GIN indexes, so the PG-side
 * `l3_nodes_source_commits_idx` (GIN over the jsonb array) cannot be
 * replicated on the JSON text column. This normalized junction table is the
 * SQLite equivalent: query it by `commit_hash` instead of scanning
 * `l3_nodes.source_commits`.
 */
export const l3NodeSourceCommitsTable = sqliteTable(
  "l3_node_source_commits",
  {
    l3NodeId: integer("l3_node_id")
      .notNull()
      .references(() => l3NodesTable.id, { onDelete: "cascade" }),
    commitHash: text("commit_hash").notNull(),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    l3NodeIdx: index("l3_node_source_commits_l3_node_idx").on(table.l3NodeId),
    commitHashIdx: index("l3_node_source_commits_commit_hash_idx").on(table.commitHash),
    uniquePair: uniqueIndex("l3_node_source_commits_unique_idx").on(
      table.l3NodeId,
      table.commitHash
    ),
  })
);
