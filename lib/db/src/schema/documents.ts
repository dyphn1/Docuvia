import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { l2NodesTable } from "./l2-nodes";

export const documentTypeEnum = pgEnum("document_type", [
  "markdown",
  "txt",
  "pdf",
  "docx",
  "pptx",
  "build_artifact",
]);

export const documentsTable = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
    l2NodeId: integer("l2_node_id").references(() => l2NodesTable.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    docType: documentTypeEnum("doc_type").notNull().default("markdown"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    contentHash: text("content_hash"),
    affiliatedAt: timestamp("affiliated_at"),
    validityStatus: text("validity_status").notNull().default("active"),
    uploadedBy: integer("uploaded_by"),
    status: text("status").notNull().default("unaffiliated"),
  },
  (table) => ({
    contentHashIdx: index("doc_content_hash_idx").on(table.contentHash),
  })
);

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
