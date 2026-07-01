import { Router } from "express";
import { db } from "@workspace/db";
import { llmConfigsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireApiKey } from "../middlewares/auth.js";

const router = Router();

const LlmConfigInputSchema = z.object({
  model: z.string().optional(),
  provider: z.string().optional(),
});

router.get("/projects/:id/llm-config", requireApiKey, async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  let [cfg] = await db
    .select()
    .from(llmConfigsTable)
    .where(eq(llmConfigsTable.projectId, projectId));
  if (!cfg) {
    [cfg] = await db
      .insert(llmConfigsTable)
      .values({
        projectId,
        provider: "openai",
        model: "gpt-5.2",
        isDefault: false,
      })
      .returning();
  }
  return res.json({ ...cfg, createdAt: cfg.createdAt.toISOString() });
});

router.patch("/projects/:id/llm-config", requireApiKey, async (req, res) => {
  const projectId = Number(req.params.id);
  const body = LlmConfigInputSchema.parse(req.body);

  let [cfg] = await db
    .select()
    .from(llmConfigsTable)
    .where(eq(llmConfigsTable.projectId, projectId));
  if (!cfg) {
    [cfg] = await db
      .insert(llmConfigsTable)
      .values({
        projectId,
        provider: body.provider ?? "openai",
        model: body.model ?? "gpt-5.2",
        isDefault: false,
      })
      .returning();
  } else {
    [cfg] = await db
      .update(llmConfigsTable)
      .set({
        ...(body.model && { model: body.model }),
        ...(body.provider && { provider: body.provider }),
        updatedAt: new Date(),
      })
      .where(eq(llmConfigsTable.id, cfg.id))
      .returning();
  }
  res.json({ ...cfg, createdAt: cfg.createdAt.toISOString() });
});

export default router;
