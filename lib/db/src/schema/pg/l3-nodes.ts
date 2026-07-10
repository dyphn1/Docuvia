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
import { z } from "zod/v4";
import { l2NodesTable } from "./l2-nodes";

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

    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at").defaultNow(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    introducedInCommit: text("introduced_in_commit"),
    verifiedUntilCommit: text("verified_until_commit"),
    validityStatus: text("validity_status").notNull().default("pending"),
    source: text("source").notNull().default("commit"),
    contentHash: text("content_hash"),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (table) => ({
    l3L2NodeIdx: index("l3_nodes_l2_node_id_idx").on(table.l2NodeId),
    contentHashIdx: index("l3_nodes_content_hash_idx").on(table.contentHash),
    sourceCommitsIdx: index("l3_nodes_source_commits_idx"),
    introducedInCommitIdx: index("l3_nodes_introduced_in_commit_idx").on(table.introducedInCommit),
  })
);

// Hand-written rather than createInsertSchema(l3NodesTable) — see l2-nodes.ts for why
// (drizzle-zod crashes on any table with a `vector`/pgvector column).
export const insertL3NodeSchema = z.object({
  l2NodeId: z.number(),
  title: z.string(),
  content: z.string().nullable().optional(),
  nodeType: z.enum(l3NodeTypeEnum.enumValues).optional(),
  sourceCommits: z.any().optional(),
  commitHash: z.string().nullable().optional(),
  aiGenerated: z.boolean().optional(),
  confidence: z.number().nullable().optional(),
  noiseScore: z.number().nullable().optional(),
  lastVerifiedAt: z.date().nullable().optional(),
  occurrenceCount: z.number().optional(),
  introducedInCommit: z.string().nullable().optional(),
  verifiedUntilCommit: z.string().nullable().optional(),
  validityStatus: z.string().optional(),
  source: z.string().optional(),
  contentHash: z.string().nullable().optional(),
});
export const updateL3NodeSchema = insertL3NodeSchema.partial();
export type InsertL3Node = z.infer<typeof insertL3NodeSchema>;
export type L3Node = typeof l3NodesTable.$inferSelect;
