import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { jobQueueTable } from "./job-queue";
import { projectsTable } from "./projects";

// Max's Rule: Dead Letter Queue (DLQ) to prevent infinite crash loops
export const errorReportsTable = pgTable(
  "error_reports",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
    jobId: integer("job_id").references(() => jobQueueTable.id, { onDelete: "set null" }),
    taskType: text("task_type").notNull(),
    errorMessage: text("error_message").notNull(),
    errorStack: text("error_stack"),
    payloadSnapshot: jsonb("payload_snapshot"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    projectIdIdx: index("error_reports_project_id_idx").on(table.projectId),
    jobIdIdx: index("error_reports_job_id_idx").on(table.jobId),
  })
);

export const insertErrorReportSchema = createInsertSchema(errorReportsTable).omit({
  id: true,
  createdAt: true,
});
