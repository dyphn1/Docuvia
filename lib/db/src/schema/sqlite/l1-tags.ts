import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const l1TagsTable = sqliteTable(
  "l1_tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (table) => ({
    nameIdx: index("l1_tags_name_idx").on(table.name),
  })
);
