import { pgTable, text, serial, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reviewEntityTypeEnum = pgEnum("review_entity_type", ["l1_tag", "l2_node", "l3_node"]);
export const reviewTaskTypeEnum = pgEnum("review_task_type", ["anchor", "correct", "validate", "merge"]);
export const reviewStatusEnum = pgEnum("review_status", ["pending", "approved", "rejected", "deferred"]);

export const reviewTasksTable = pgTable("review_tasks", {
  id: serial("id").primaryKey(),
  entityType: reviewEntityTypeEnum("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  taskType: reviewTaskTypeEnum("task_type").notNull(),
  status: reviewStatusEnum("status").notNull().default("pending"),
  description: text("description"),
  correctedValue: text("corrected_value"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const insertReviewTaskSchema = createInsertSchema(reviewTasksTable).omit({ id: true, createdAt: true, resolvedAt: true });
export type InsertReviewTask = z.infer<typeof insertReviewTaskSchema>;
export type ReviewTask = typeof reviewTasksTable.$inferSelect;
