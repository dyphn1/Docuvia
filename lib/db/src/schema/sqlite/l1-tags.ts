import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const l1TagsTable = sqliteTable(
  "l1_tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    slug: text("slug").notNull().unique(),
    // Defaulted for parity with the PG schema: local writers (e.g. SqliteGraphRepository)
    // do not supply these fields.
    category: text("category").notNull().default("Feature"),
    description: text("description"),
    isAnchored: integer("is_anchored", { mode: "boolean" }).notNull().default(false),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    nameIdx: index("l1_tags_name_idx").on(table.name),
    slugIdx: index("l1_tags_slug_idx").on(table.slug),
    categoryIdx: index("l1_tags_category_idx").on(table.category),
    isAnchoredIdx: index("l1_tags_is_anchored_idx").on(table.isAnchored),
  })
);
