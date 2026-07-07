import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { l2NodesTable } from "./l2-nodes.js";

export const l3NodesTable = sqliteTable(
  "l3_nodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    l2NodeId: integer("l2_node_id")
      .notNull()
      .references(() => l2NodesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content"),
    nodeType: text("node_type")
      .$type<"change" | "rule" | "decision" | "context">()
      .notNull()
      .default("change"),
    sourceCommits: text("source_commits", { mode: "json" }).$type<string[]>().notNull().default([]),
    commitHash: text("commit_hash"),
    aiGenerated: integer("ai_generated", { mode: "boolean" }).notNull().default(true),
    confidence: real("confidence"),
    noiseScore: real("noise_score"),
    // embedding vector omitted
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
    lastVerifiedAt: text("last_verified_at").default("CURRENT_TIMESTAMP"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    introducedInCommit: text("introduced_in_commit"),
    verifiedUntilCommit: text("verified_until_commit"),
    validityStatus: text("validity_status").notNull().default("pending"),
    source: text("source").notNull().default("commit"),
    contentHash: text("content_hash"),
  },
  (table) => ({
    l3L2NodeIdx: index("l3_nodes_l2_node_id_idx").on(table.l2NodeId),
    contentHashIdx: index("l3_nodes_content_hash_idx").on(table.contentHash),
    introducedInCommitIdx: index("l3_nodes_introduced_in_commit_idx").on(table.introducedInCommit),
    sourceCommitsIdx: index("l3_nodes_source_commits_idx").on(table.sourceCommits),
  })
);
