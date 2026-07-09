import { API_MESSAGES } from "@workspace/core";
import { logger } from "@workspace/core";
import { Router } from "express";
import { PullRequestService } from "../services/pull-request.service.js";
import { pullRequestsTable } from "@workspace/db";
import { ProjectService } from "../services/project.service.js";

const router = Router();
const pullRequestService = new PullRequestService();

// GET /projects/:id/pull-requests
router.get("/projects/:id/pull-requests", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) {
    return res.status(400).json({ error: API_MESSAGES.INVALID_PROJECT_ID });
  }

  const project = await new ProjectService().getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: API_MESSAGES.PROJECT_NOT_FOUND });
  }

  const prs = await pullRequestService.getPullRequestsByProjectId(projectId);

  return res.json(prs.map(serializePr));
});

// GET /projects/:id/pull-requests/:prNumber
router.get("/projects/:id/pull-requests/:prNumber", async (req, res) => {
  const projectId = Number(req.params.id);
  const prNumber = Number(req.params.prNumber);
  if (isNaN(projectId) || isNaN(prNumber)) {
    return res.status(400).json({ error: API_MESSAGES.INVALID_PARAMETERS });
  }

  const pr = await pullRequestService.getPullRequest(projectId, prNumber);

  if (!pr) {
    return res.status(404).json({ error: API_MESSAGES.PULL_REQUEST_NOT_FOUND });
  }

  const commits = await pullRequestService.getCommitsAfterPr(projectId, pr.createdAt);

  const commitHashes = commits.map((c) => c.hash);

  const l3Nodes = await pullRequestService.getL3NodesByProjectId(projectId);

  const prL3Nodes = l3Nodes.filter((n) => n.commitHash && commitHashes.includes(n.commitHash));

  const l2NodeIds = [...new Set(prL3Nodes.map((n) => n.l2NodeId))];
  const l2Nodes = await pullRequestService.getL2NodesByIds(projectId, l2NodeIds);

  return res.json({
    pr: serializePr(pr),
    commitsCount: commits.length,
    l2Nodes: l2Nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      description: n.description,
      createdAt: n.createdAt.toISOString(),
    })),
    l3Nodes: prL3Nodes.map((n) => ({
      id: n.id,
      title: n.title,
      nodeType: n.nodeType,
      content: n.content,
      commitHash: n.commitHash,
      createdAt: n.createdAt.toISOString(),
    })),
    aiSummary: pr.aiSummary,
  });
});

// POST /projects/:id/pull-requests/:prNumber/analyze
router.post("/projects/:id/pull-requests/:prNumber/analyze", async (req, res) => {
  const projectId = Number(req.params.id);
  const prNumber = Number(req.params.prNumber);
  if (isNaN(projectId) || isNaN(prNumber)) {
    return res.status(400).json({ error: API_MESSAGES.INVALID_PARAMETERS });
  }

  const pr = await pullRequestService.getPullRequest(projectId, prNumber);

  if (!pr) {
    return res.status(404).json({ error: API_MESSAGES.PULL_REQUEST_NOT_FOUND });
  }

  if (pr.analysisStatus === "completed") {
    return res.status(202).json({
      status: "already_completed",
      message: "This PR has already been analyzed. Re-running analysis.",
    });
  }

  res.status(202).json({ status: "triggered", message: API_MESSAGES.ANALYSIS_TRIGGERED });

  setImmediate(async () => {
    try {
      await pullRequestService.runAnalysis(projectId, prNumber, pr.createdAt);
    } catch (err) {
      logger.error({ err }, "Failed to run PR analysis");
    }
  });
  return;
});

function serializePr(pr: typeof pullRequestsTable.$inferSelect) {
  return {
    ...pr,
    mergedAt: pr.mergedAt?.toISOString() ?? null,
    createdAt: pr.createdAt.toISOString(),
    updatedAt: pr.updatedAt.toISOString(),
  };
}

export { router as pullRequestsRouter };
