import { Router, Request, Response, NextFunction } from "express";
import { ProjectService } from "../services/project.service";
import { ExportService } from "../services/export.service";
import { requireApiKey } from "../middlewares/auth";

const router = Router();
const exportService = new ExportService();

const requireExportAuth = [requireApiKey];

const checkProjectOwnership = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const projectId = Number(req.params.id);
  const userId = (req as any).user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const project = await new ProjectService().getProjectById(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (project.ownerId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
};

router.get(
  "/projects/:id/export",
  ...requireExportAuth,
  checkProjectOwnership,
  async (req, res) => {
    const projectId = Number(req.params.id);
    const result = await exportService.exportProjectToJson(projectId);
    if (!result) return res.status(404).json({ error: "Project not found" });
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
    if (!project) return res.status(404).json({ error: "Project not found" });

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
