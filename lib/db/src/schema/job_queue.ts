import { pgTable, text, serial, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const jobStatusEnum = pgEnum("job_status", ["pending", "processing", "failed", "completed"]);

export const jobQueueTable = pgTable("job_queue", {
  id: serial("id").primaryKey(),
  taskType: text("task_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: jobStatusEnum("status").notNull().default("pending"),
  lockedAt: timestamp("locked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type JobQueue = typeof jobQueueTable.$inferSelect;
export type InsertJobQueue = typeof jobQueueTable.$inferInsert;
