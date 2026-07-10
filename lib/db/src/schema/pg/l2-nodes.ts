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

    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at").defaultNow(),
    pathPatterns: jsonb("path_patterns"),
    reindexRequired: boolean("reindex_required").notNull().default(false),
    isBootstrapConfirmed: boolean("is_bootstrap_confirmed").notNull().default(false),
    contentHash: text("content_hash"),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (table) => ({
    l2ProjectIdx: index("l2_nodes_project_id_idx").on(table.projectId),
    nameIdx: index("l2_nodes_name_idx").on(table.name),
    contentHashIdx: index("l2_nodes_content_hash_idx").on(table.contentHash),
  })
);

// Hand-written rather than createInsertSchema(l2NodesTable): drizzle-zod maps every
// column upfront (before .omit()/refine can apply), and has no case for the `vector`
// (pgvector) column type added to drizzle-orm after drizzle-zod was released, so it
// throws on any table with an `embedding` column. embedding is populated by the
// embedding service directly, never submitted via these request-body schemas.
export const insertL2NodeSchema = z.object({
  projectId: z.number(),
  name: z.string(),
  type: z.enum(l2NodeTypeEnum.enumValues).optional(),
  isSystem: z.boolean().optional(),
  description: z.string().nullable().optional(),
  aiGenerated: z.boolean().optional(),
  needsReview: z.boolean().optional(),
  lastVerifiedAt: z.date().nullable().optional(),
  pathPatterns: z.any().nullable().optional(),
  reindexRequired: z.boolean().optional(),
  isBootstrapConfirmed: z.boolean().optional(),
  contentHash: z.string().nullable().optional(),
});
export const updateL2NodeSchema = insertL2NodeSchema.partial();
export type InsertL2Node = z.infer<typeof insertL2NodeSchema>;
export type L2Node = typeof l2NodesTable.$inferSelect;
