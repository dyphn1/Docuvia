import { pgTable, text, serial, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const l1TagsTable = pgTable("l1_tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
  description: text("description"),
  isAnchored: boolean("is_anchored").notNull().default(false),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertL1TagSchema = createInsertSchema(l1TagsTable).omit({ id: true, createdAt: true, usageCount: true });
export const updateL1TagSchema = insertL1TagSchema.partial();
export type InsertL1Tag = z.infer<typeof insertL1TagSchema>;
export type L1Tag = typeof l1TagsTable.$inferSelect;
