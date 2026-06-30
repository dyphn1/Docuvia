import { Router } from "express";
import { db } from "@workspace/db";
import { projectIntegrationsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { logger } from "@workspace/core";
import { sendTestNotification } from "@workspace/core";

const router = Router();

import { CreateProjectIntegrationBody, UpdateProjectIntegrationBody } from "@workspace/api-zod";

function serializeIntegration(row: typeof projectIntegrationsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/projects/:id/integrations", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project id" });

    const rows = await db
      .select()
      .from(projectIntegrationsTable)
      .where(eq(projectIntegrationsTable.projectId, projectId));

    return res.json(rows.map(serializeIntegration));
  } catch (err) {
    logger.error({ err }, "Failed to list integrations");
    return res.status(500).json({ error: "Failed to list integrations" });
  }
});

router.post("/projects/:id/integrations", async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: "Invalid project id" });

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const body = CreateProjectIntegrationBody.parse(req.body);

    const [created] = await db
      .insert(projectIntegrationsTable)
      .values({ projectId, ...body })
      .returning();

    return res.status(201).json(serializeIntegration(created));
  } catch (err) {
    logger.error({ err }, "Failed to create integration");
    return res.status(500).json({ error: "Failed to create integration" });
  }
});

router.patch("/integrations/:integrationId", async (req, res) => {
  try {
    const integrationId = parseInt(req.params.integrationId, 10);
    if (isNaN(integrationId)) return res.status(400).json({ error: "Invalid integration id" });

    const body = UpdateProjectIntegrationBody.parse(req.body);

    const [updated] = await db
      .update(projectIntegrationsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(projectIntegrationsTable.id, integrationId))
      .returning();

    if (!updated) return res.status(404).json({ error: "Integration not found" });

    return res.json(serializeIntegration(updated));
  } catch (err) {
    logger.error({ err }, "Failed to update integration");
    return res.status(500).json({ error: "Failed to update integration" });
  }
});

router.delete("/integrations/:integrationId", async (req, res) => {
  try {
    const integrationId = parseInt(req.params.integrationId, 10);
    if (isNaN(integrationId)) return res.status(400).json({ error: "Invalid integration id" });

    const [deleted] = await db
      .delete(projectIntegrationsTable)
      .where(eq(projectIntegrationsTable.id, integrationId))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Integration not found" });

    return res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Failed to delete integration");
    return res.status(500).json({ error: "Failed to delete integration" });
  }
});

router.post("/integrations/:integrationId/test", async (req, res) => {
  try {
    const integrationId = parseInt(req.params.integrationId, 10);
    if (isNaN(integrationId)) return res.status(400).json({ error: "Invalid integration id" });

    const [integration] = await db
      .select()
      .from(projectIntegrationsTable)
      .where(eq(projectIntegrationsTable.id, integrationId));

    if (!integration) return res.status(404).json({ error: "Integration not found" });

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, integration.projectId));

    const projectName = project?.name ?? `Project #${integration.projectId}`;
    const success = await sendTestNotification(integration, projectName);

    return res.json({ success });
  } catch (err) {
    logger.error({ err }, "Failed to send test notification");
    return res.status(500).json({ error: "Failed to send test notification" });
  }
});

export default router;
