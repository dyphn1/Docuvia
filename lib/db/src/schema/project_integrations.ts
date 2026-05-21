import { pgTable, text, serial, integer, boolean, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const integrationTypeEnum = pgEnum("integration_type", ["slack", "teams"]);

export const projectIntegrationsTable = pgTable("project_integrations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  integrationType: integrationTypeEnum("integration_type").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  notificationTypes: jsonb("notification_types").$type<string[] | null>().default(null),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectIntegrationSchema = createInsertSchema(projectIntegrationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateProjectIntegrationSchema = insertProjectIntegrationSchema.partial();
export const selectProjectIntegrationSchema = createSelectSchema(projectIntegrationsTable);
export type InsertProjectIntegration = z.infer<typeof insertProjectIntegrationSchema>;
export type ProjectIntegration = typeof projectIntegrationsTable.$inferSelect;
