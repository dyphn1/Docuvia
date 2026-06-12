import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pgTable, text, serial, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const activityTypeEnum = pgEnum("activity_type", [
  "commit",
  "l2_created",
  "l3_created",
  "review_resolved",
  "tag_added",
  "document",
]);

export const activityLogTable = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  type: activityTypeEnum("type").notNull(),
  description: text("description").notNull(),
  projectId: integer("project_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertActivityLogSchema = createInsertSchema(activityLogTable).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
