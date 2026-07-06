import { Router, Request, Response, NextFunction } from "express";
import { ProjectService } from "../services/project.service";
import { TopologyService } from "../services/topology.service";
import { requireApiKey } from "../middlewares/auth";

const router = Router();
const topologyService = new TopologyService();

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

router.get("/projects/:id/topology", requireApiKey, checkProjectOwnership, async (req, res) => {
  const projectId = Number(req.params.id);
  const collapseParam = req.query.collapse;
  const collapse =
    collapseParam === "file" || collapseParam === "symbol" || collapseParam === "auto"
      ? collapseParam
      : undefined;

  const result = await topologyService.getProjectTopology(projectId, { collapse });
  if (!result) return res.status(404).json({ error: "Project not found" });
  return res.json(result);
});

export { router as topologyRouter };
