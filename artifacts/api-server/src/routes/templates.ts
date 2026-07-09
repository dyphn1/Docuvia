import { API_MESSAGES } from "@workspace/core";
import { Router } from "express";
import { ProjectService } from "../services/project.service.js";
import { z } from "zod";
import { DEFAULT_PROMPTS } from "@workspace/core";
import { TemplateService } from "../services/template.service.js";

const router = Router();
const templateService = new TemplateService();

const TemplateUpdateSchema = z.object({
  systemPrompt: z.string().min(10),
});

router.get("/projects/:id/templates", async (req, res) => {
  const projectId = Number(req.params.id);
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) return res.status(404).json({ error: API_MESSAGES.PROJECT_NOT_FOUND });

  const types = ["l1_tagger", "l2_extractor", "l3_generator"] as const;
  const dbTemplates = await templateService.getTemplatesByProjectId(projectId);

  const dbMap = new Map(dbTemplates.map((t) => [t.templateType, t]));

  const result = await Promise.all(
    types.map(async (type) => {
      const existing = dbMap.get(type);
      let upgradeInfo = { hasUpgradeWarning: false, latestParentVersion: undefined };
      if (existing) {
        upgradeInfo = (await templateService.checkUpgradeWarning(existing)) as any;
      }
      return {
        templateType: type,
        systemPrompt: existing?.systemPrompt ?? DEFAULT_PROMPTS[type] ?? "",
        isCustom: !!existing,
        isActive: existing?.isActive ?? true,
        id: existing?.id ?? null,
        updatedAt: existing?.updatedAt?.toISOString() ?? null,
        parentTemplateId: existing?.parentTemplateId ?? null,
        version: existing?.version ?? 1,
        hasUpgradeWarning: upgradeInfo.hasUpgradeWarning,
        latestParentVersion: upgradeInfo.latestParentVersion,
      };
    })
  );

  return res.json(result);
});

router.put("/projects/:id/templates/:type", async (req, res) => {
  const projectId = Number(req.params.id);
  const templateType = req.params.type as "l1_tagger" | "l2_extractor" | "l3_generator";

  const validTypes = ["l1_tagger", "l2_extractor", "l3_generator"];
  if (!validTypes.includes(templateType)) {
    return res.status(400).json({ error: API_MESSAGES.INVALID_TEMPLATE_TYPE });
  }

  const project = await new ProjectService().getProjectById(projectId);
  if (!project) return res.status(404).json({ error: API_MESSAGES.PROJECT_NOT_FOUND });

  const body = TemplateUpdateSchema.parse(req.body);

  const existing = await templateService.getTemplate(projectId, templateType);

  if (existing) {
    const updated = await templateService.updateTemplate(existing.id, body.systemPrompt);
    return res.json({
      ...updated,
      isCustom: true,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  }

  const created = await templateService.createTemplate(projectId, templateType, body.systemPrompt);

  return res.status(201).json({
    ...created,
    isCustom: true,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  });
});

router.delete("/projects/:id/templates/:type", async (req, res) => {
  const projectId = Number(req.params.id);
  const templateType = req.params.type;

  await templateService.deleteTemplate(projectId, templateType);

  return res.status(204).send();
});

export { router as templatesRouter };
