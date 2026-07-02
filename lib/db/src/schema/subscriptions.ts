import { pgTable, serial, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    subscriberProjectId: integer("subscriber_project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    publisherProjectId: integer("publisher_project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.subscriberProjectId, t.publisherProjectId),
    index("subscriptions_subscriber_project_id_idx").on(t.subscriberProjectId),
    index("subscriptions_publisher_project_id_idx").on(t.publisherProjectId),
  ]
);

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  id: true,
  createdAt: true,
});
export const selectSubscriptionSchema = createSelectSchema(subscriptionsTable);
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
