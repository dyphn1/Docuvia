import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const correctionExamplesTable = pgTable("correction_examples", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  originalContent: text("original_content").notNull(),
  correctedContent: text("corrected_content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCorrectionExampleSchema = createInsertSchema(correctionExamplesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCorrectionExample = z.infer<typeof insertCorrectionExampleSchema>;
export type CorrectionExample = typeof correctionExamplesTable.$inferSelect;
