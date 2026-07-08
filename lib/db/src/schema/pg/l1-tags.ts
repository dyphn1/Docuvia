import { pgTable, text, serial, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const l1TagsTable = pgTable(
  "l1_tags",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    // Nullable for backward compatibility: pre-existing rows and insert sites do not provide slugs.
    slug: text("slug").unique(),
    category: text("category").notNull(),
    description: text("description"),
    isAnchored: boolean("is_anchored").notNull().default(false),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: index("l1_tags_name_idx").on(table.name),
    slugIdx: index("l1_tags_slug_idx").on(table.slug),
    categoryIdx: index("l1_tags_category_idx").on(table.category),
    isAnchoredIdx: index("l1_tags_is_anchored_idx").on(table.isAnchored),
  })
);

export const insertL1TagSchema = createInsertSchema(l1TagsTable).omit({
  id: true,
  createdAt: true,
  usageCount: true,
});

export type InsertL1Tag = z.infer<typeof insertL1TagSchema>;
export type L1Tag = typeof l1TagsTable.$inferSelect;
