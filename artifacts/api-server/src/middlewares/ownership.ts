import { type Request, type Response, type NextFunction } from "express";
import { ProjectService } from "../services/project.service.js";
import { API_MESSAGES } from "@workspace/core";

export async function checkProjectOwnership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const projectId = Number(req.params.id);
  const userId = (req as any).user?.id;

  if (!userId) {
    res.status(401).json({ error: API_MESSAGES.UNAUTHORIZED });
    return;
  }

  const project = await new ProjectService().getProjectById(projectId);
  if (!project) {
    res.status(404).json({ error: API_MESSAGES.PROJECT_NOT_FOUND });
    return;
  }
  if (project.ownerId !== userId) {
    res.status(403).json({ error: API_MESSAGES.FORBIDDEN });
    return;
  }

  next();
}
