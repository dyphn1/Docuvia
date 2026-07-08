import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod";
const createInsertSchema = (a: any) => ({ omit: () => z.any(), partial: () => z.any() }) as any;
const createSelectSchema = (a: any) => z.any();
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("notifications_project_id_idx").on(table.projectId)]
);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  createdAt: true,
});
export const selectNotificationSchema = createSelectSchema(notificationsTable);
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
