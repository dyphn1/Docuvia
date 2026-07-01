import { Router } from "express";
import {
  CreateProjectBody,
  UpdateProjectParams,
  UpdateProjectBody,
  DeleteProjectParams,
  GetProjectParams,
  GetProjectGraphParams,
  ListCommitsParams,
  CreateCommitParams,
  CreateCommitBody,
  ListProjectL2NodesParams,
} from "@workspace/api-zod";
import { requireApiKey } from "../middlewares/auth.js";
import { ProjectService } from "../services/project.service.js";

const router = Router();
const projectService = new ProjectService();

router.get("/projects", async (req, res) => {
  const result = await projectService.listProjects();
  res.json(result);
});

router.post("/projects", async (req, res) => {
  const body = CreateProjectBody.parse(req.body);
  const result = await projectService.createProject(body);
  res.status(201).json(result);
});

router.get("/projects/:id", async (req, res) => {
  const { id } = GetProjectParams.parse({ id: Number(req.params.id) });
  const result = await projectService.getProject(id);
  if (!result) return res.status(404).json({ error: "Not found" });
  return res.json(result);
});

router.patch("/projects/:id", async (req, res) => {
  const { id } = UpdateProjectParams.parse({ id: Number(req.params.id) });
  const body = UpdateProjectBody.parse(req.body);
  const result = await projectService.updateProject(id, body);
  if (!result) return res.status(404).json({ error: "Not found" });
  return res.json(result);
});

router.delete("/projects/:id", async (req, res) => {
  const { id } = DeleteProjectParams.parse({ id: Number(req.params.id) });
  await projectService.deleteProject(id);
  res.status(204).send();
});

router.get("/projects/:id/graph", async (req, res) => {
  const { id } = GetProjectGraphParams.parse({ id: Number(req.params.id) });
  const result = await projectService.getProjectGraph(id);
  res.json(result);
});

router.get("/projects/:id/commits", async (req, res) => {
  const { id } = ListCommitsParams.parse({ id: Number(req.params.id) });
  const result = await projectService.listProjectCommits(id);
  res.json(result);
});

router.post("/projects/:id/commits", async (req, res) => {
  const { id } = CreateCommitParams.parse({ id: Number(req.params.id) });
  const body = CreateCommitBody.parse(req.body);
  const result = await projectService.createProjectCommit(id, body);
  res.status(201).json(result);
});

router.get("/projects/:id/l2-nodes", async (req, res) => {
  const { id } = ListProjectL2NodesParams.parse({ id: Number(req.params.id) });
  const result = await projectService.listProjectL2Nodes(id);
  res.json(result);
});

// POST /projects/:id/sync (Trigger ingestion pipeline from CLI)
router.post("/projects/:id/sync", requireApiKey, async (req, res) => {
  const projectId = Number(req.params.id);
  const result = await projectService.syncProject(projectId);
  if ("error" in result) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  return res.json(result);
});

export default router;
