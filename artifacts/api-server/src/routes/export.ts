import { Router } from "express";
import { ProjectService } from "../services/project.service";
import { ExportService } from "../services/export.service";
import { requireApiKey } from "../middlewares/auth";
import { checkProjectOwnership } from "../middlewares/ownership.js";
import { API_MESSAGES } from "@workspace/core";

const router = Router();
const exportService = new ExportService();

const requireExportAuth = [requireApiKey];

router.get(
  "/projects/:id/export",
  ...requireExportAuth,
  checkProjectOwnership,
  async (req, res) => {
    const projectId = Number(req.params.id);
    const result = await exportService.exportProjectToJson(projectId);
    if (!result) return res.status(404).json({ error: API_MESSAGES.PROJECT_NOT_FOUND });
    return res.json(result);
  }
);

// GET /projects/:id/export/md (Markdown Export with Stream/Chunking)
router.get(
  "/projects/:id/export/md",
  ...requireExportAuth,
  checkProjectOwnership,
  async (req, res) => {
    const projectId = Number(req.params.id);
    const project = await new ProjectService().getProjectById(projectId);
    if (!project) return res.status(404).json({ error: API_MESSAGES.PROJECT_NOT_FOUND });

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${project.name.replace(/[^a-zA-Z0-9]/g, "_")}_export.md"`
    );

    await exportService.exportProjectToMarkdownStream(projectId, res);
    res.end();
    return;
  }
);

export { router as exportRouter };
