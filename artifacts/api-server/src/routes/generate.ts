import { Router } from "express";
import { ProjectService } from "../services/project.service";
import { logger } from "@workspace/core";
import { GenerateService } from "@workspace/core";
import { requireApiKey } from "../middlewares/auth.js";
import { z } from "zod";

import { GenerateKnowledgeBody } from "@workspace/api-zod";
import { executeKnowledgeGeneration } from "@workspace/core";
import { API_MESSAGES } from "@workspace/core";

const router = Router();
const generateService = new GenerateService();

const SieveExtractionInputSchema = z.object({
  sourceText: z.string(),
  sourceFile: z.string().optional(),
  commitHash: z.string().optional(),
});

router.post("/projects/:id/extract/sieve", async (req, res) => {
  const projectId = Number(req.params.id);
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) return res.status(404).json({ error: API_MESSAGES.PROJECT_NOT_FOUND });

  const bodyParsed = SieveExtractionInputSchema.safeParse(req.body ?? {});
  if (!bodyParsed.success) return res.status(400).json({ error: API_MESSAGES.INVALID_INPUT });

  const { sourceText, sourceFile, commitHash } = bodyParsed.data;

  try {
    const decisions = await generateService.extractSieveDecisions(
      projectId,
      sourceText,
      sourceFile,
      commitHash
    );
    return res.json({ decisions });
  } catch (err) {
    return res.status(500).json({ error: API_MESSAGES.FAILED_TO_EXTRACT_DECISIONS });
  }
});

router.post("/projects/:id/generate", requireApiKey, async (req, res) => {
  const projectId = Number(req.params.id);
  const body = GenerateKnowledgeBody.parse(req.body ?? {});

  try {
    const result = await executeKnowledgeGeneration(projectId, (req as any).user?.id, body);
    return res.json(result);
  } catch (err: any) {
    if (err.message === API_MESSAGES.PROJECT_NOT_FOUND) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message === API_MESSAGES.FORBIDDEN_NOT_PROJECT_OWNER) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message === API_MESSAGES.PROJECT_ALREADY_INDEXING) {
      return res.status(409).json({ error: err.message });
    }
    logger.error({ err }, "Knowledge generation failed");
    return res.status(500).json({ error: API_MESSAGES.FAILED_TO_GENERATE_KNOWLEDGE });
  }
});

router.post("/admin/reindex-embeddings", async (req, res) => {
  const result = await generateService.reindexEmbeddings();
  res.json(result);
});

export { router as generateRouter };
