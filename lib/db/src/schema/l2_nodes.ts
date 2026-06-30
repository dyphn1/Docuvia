import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  vector,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const l2NodeTypeEnum = pgEnum("l2_node_type", [
  "package",
  "module",
  "pcd",
  "sys-uncategorized",
]);

export const l2NodesTable = pgTable(
  "l2_nodes",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: l2NodeTypeEnum("type").notNull().default("module"),
    isSystem: boolean("is_system").notNull().default(false),
    description: text("description"),
    aiGenerated: boolean("ai_generated").notNull().default(true),
    needsReview: boolean("needs_review").notNull().default(false),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at").defaultNow(),
    pathPatterns: jsonb("path_patterns"),
    reindexRequired: boolean("reindex_required").notNull().default(false),
    isBootstrapConfirmed: boolean("is_bootstrap_confirmed").notNull().default(false),
    contentHash: text("content_hash"),
  },
  (table) => ({
    l2EmbeddingIdx: index("l2_nodes_embedding_idx").using(
      "ivfflat",
      table.embedding.op("vector_cosine_ops")
    ),
  })
);

export const l2NodeL1TagsTable = pgTable("l2_node_l1_tags", {
  id: serial("id").primaryKey(),
  l2NodeId: integer("l2_node_id")
    .notNull()
    .references(() => l2NodesTable.id, { onDelete: "cascade" }),
  l1TagId: integer("l1_tag_id").notNull(),
});

export const insertL2NodeSchema = createInsertSchema(l2NodesTable).omit({
  id: true,
  createdAt: true,
});
export const updateL2NodeSchema = insertL2NodeSchema.partial();
export type InsertL2Node = z.infer<typeof insertL2NodeSchema>;
export type L2Node = typeof l2NodesTable.$inferSelect;
