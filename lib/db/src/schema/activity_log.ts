import { pgTable, text, serial, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const activityTypeEnum = pgEnum("activity_type", ["commit", "l2_created", "l3_created", "review_resolved", "tag_added"]);

export const activityLogTable = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  type: activityTypeEnum("type").notNull(),
  description: text("description").notNull(),
  projectId: integer("project_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
