import { API_MESSAGES } from "@workspace/core";
import { Router } from "express";
import { ProjectService } from "../services/project.service";
import { LlmConfigService } from "../services/llm-config.service";
import { z } from "zod";
import { requireApiKey } from "../middlewares/auth.js";

const router = Router();
const llmConfigService = new LlmConfigService();

const LlmConfigInputSchema = z.object({
  model: z.string().optional(),
  provider: z.string().optional(),
});

router.get("/projects/:id/llm-config", requireApiKey, async (req, res) => {
  const projectId = Number(req.params.id);
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) return res.status(404).json({ error: API_MESSAGES.PROJECT_NOT_FOUND });

  const cfg = await llmConfigService.getOrCreateConfig(projectId);
  return res.json({ ...cfg, createdAt: cfg.createdAt.toISOString() });
});

router.patch("/projects/:id/llm-config", requireApiKey, async (req, res) => {
  const projectId = Number(req.params.id);
  const body = LlmConfigInputSchema.parse(req.body);

  let cfg = await llmConfigService.getConfigByProjectId(projectId);
  if (!cfg) {
    cfg = await llmConfigService.createConfig(
      projectId,
      body.provider ?? "openai",
      body.model ?? "gpt-5.2"
    );
  } else {
    cfg = await llmConfigService.updateConfig(cfg.id, {
      ...(body.model && { model: body.model }),
      ...(body.provider && { provider: body.provider }),
    });
  }
  res.json({ ...cfg, createdAt: cfg.createdAt.toISOString() });
});

export { router as llmConfigRouter };
