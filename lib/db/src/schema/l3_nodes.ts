import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  real,
  jsonb,
  pgEnum,
  vector,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { l2NodesTable } from "./l2_nodes";

export const l3NodeTypeEnum = pgEnum("l3_node_type", ["change", "rule", "decision", "context"]);

export const l3NodesTable = pgTable(
  "l3_nodes",
  {
    id: serial("id").primaryKey(),
    l2NodeId: integer("l2_node_id")
      .notNull()
      .references(() => l2NodesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content"),
    nodeType: l3NodeTypeEnum("node_type").notNull().default("change"),
    sourceCommits: jsonb("source_commits").$type<string[]>().notNull().default([]),
    // @deprecated — superseded by sourceCommits[0] (v2). Keep for backward compat.
    commitHash: text("commit_hash"),
    aiGenerated: boolean("ai_generated").notNull().default(true),
    confidence: real("confidence"),
    noiseScore: real("noise_score"),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at").defaultNow(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    introducedInCommit: text("introduced_in_commit"),
    verifiedUntilCommit: text("verified_until_commit"),
    validityStatus: text("validity_status").notNull().default("pending"),
    source: text("source").notNull().default("commit"),
  },
  (table) => ({
    l3EmbeddingIdx: index("l3_nodes_embedding_idx").using(
      "ivfflat",
      table.embedding.op("vector_cosine_ops")
    ),
  })
);

export const insertL3NodeSchema = createInsertSchema(l3NodesTable).omit({
  id: true,
  createdAt: true,
});
export const updateL3NodeSchema = insertL3NodeSchema.partial();
export type InsertL3Node = z.infer<typeof insertL3NodeSchema>;
export type L3Node = typeof l3NodesTable.$inferSelect;
