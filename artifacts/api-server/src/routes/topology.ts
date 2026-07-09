import { Router } from "express";
import { TopologyService } from "../services/topology.service";
import { requireApiKey } from "../middlewares/auth";
import { checkProjectOwnership } from "../middlewares/ownership.js";
import { API_MESSAGES } from "@workspace/core";

const router = Router();
const topologyService = new TopologyService();

router.get("/projects/:id/topology", requireApiKey, checkProjectOwnership, async (req, res) => {
  const projectId = Number(req.params.id);
  const collapseParam = req.query.collapse;
  const collapse =
    collapseParam === "file" || collapseParam === "symbol" || collapseParam === "auto"
      ? collapseParam
      : undefined;

  const result = await topologyService.getProjectTopology(projectId, { collapse });
  if (!result) return res.status(404).json({ error: API_MESSAGES.PROJECT_NOT_FOUND });
  return res.json(result);
});

export { router as topologyRouter };
