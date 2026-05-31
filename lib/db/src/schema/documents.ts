import { pgTable, text, serial, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const documentTypeEnum = pgEnum("document_type", [
  "markdown",
  "txt",
  "pdf",
  "docx",
  "pptx",
  "build_artifact",
]);

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  docType: documentTypeEnum("doc_type").notNull().default("markdown"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  contentHash: text("content_hash"),
  affiliatedAt: timestamp("affiliated_at"),
  status: text("status").notNull().default("unaffiliated"),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
