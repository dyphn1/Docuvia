import { Router } from "express";
import { db } from "@workspace/db";
import {
  pullRequestsTable,
  l2NodesTable,
  l3NodesTable,
  commitsTable,
  projectsTable,
} from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

// GET /projects/:id/pull-requests
router.get("/projects/:id/pull-requests", async (req, res) => {
  const projectId = Number(req.params.id);
  if (isNaN(projectId)) {
    return res.status(400).json({ error: "Invalid project id" });
  }

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const prs = await db
    .select()
    .from(pullRequestsTable)
    .where(eq(pullRequestsTable.projectId, projectId))
    .orderBy(sql`${pullRequestsTable.createdAt} desc`);

  return res.json(prs.map(serializePr));
});

// GET /projects/:id/pull-requests/:prNumber
router.get("/projects/:id/pull-requests/:prNumber", async (req, res) => {
  const projectId = Number(req.params.id);
  const prNumber = Number(req.params.prNumber);
  if (isNaN(projectId) || isNaN(prNumber)) {
    return res.status(400).json({ error: "Invalid parameters" });
  }

  const [pr] = await db
    .select()
    .from(pullRequestsTable)
    .where(
      and(
        eq(pullRequestsTable.projectId, projectId),
        eq(pullRequestsTable.githubPrNumber, prNumber)
      )
    );

  if (!pr) {
    return res.status(404).json({ error: "Pull request not found" });
  }

  const commits = await db
    .select({ hash: commitsTable.hash })
    .from(commitsTable)
    .where(
      and(
        eq(commitsTable.projectId, projectId),
        gte(commitsTable.createdAt, pr.createdAt)
      )
    );

  const commitHashes = commits.map((c) => c.hash);

  // L3 nodes linked to those commits
  const l3Nodes = await db
    .select({
      id: l3NodesTable.id,
      title: l3NodesTable.title,
      nodeType: l3NodesTable.nodeType,
      content: l3NodesTable.content,
      commitHash: l3NodesTable.commitHash,
      l2NodeId: l3NodesTable.l2NodeId,
      createdAt: l3NodesTable.createdAt,
    })
    .from(l3NodesTable)
    .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
    .where(eq(l2NodesTable.projectId, projectId));

  const prL3Nodes = l3Nodes.filter(
    (n) => n.commitHash && commitHashes.includes(n.commitHash)
  );

  const l2NodeIds = [...new Set(prL3Nodes.map((n) => n.l2NodeId))];
  const l2Nodes =
    l2NodeIds.length > 0
      ? await db
          .select()
          .from(l2NodesTable)
          .where(eq(l2NodesTable.projectId, projectId))
          .then((rows) => rows.filter((r) => l2NodeIds.includes(r.id)))
      : [];

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
    return res.status(400).json({ error: "Invalid parameters" });
  }

  const [pr] = await db
    .select()
    .from(pullRequestsTable)
    .where(
      and(
        eq(pullRequestsTable.projectId, projectId),
        eq(pullRequestsTable.githubPrNumber, prNumber)
      )
    );

  if (!pr) {
    return res.status(404).json({ error: "Pull request not found" });
  }

  if (pr.analysisStatus === "completed") {
    return res.status(202).json({
      status: "already_completed",
      message: "This PR has already been analyzed. Re-running analysis.",
    });
  }

  // Run analysis asynchronously
  res.status(202).json({ status: "triggered", message: "Analysis triggered" });

  setImmediate(async () => {
    try {
      await db
        .update(pullRequestsTable)
        .set({ analysisStatus: "in_progress", updatedAt: new Date() })
        .where(
          and(
            eq(pullRequestsTable.projectId, projectId),
            eq(pullRequestsTable.githubPrNumber, prNumber)
          )
        );

      const l3Nodes = await db
        .select({
          title: l3NodesTable.title,
          nodeType: l3NodesTable.nodeType,
          content: l3NodesTable.content,
        })
        .from(l3NodesTable)
        .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
        .where(
          and(
            eq(l2NodesTable.projectId, projectId),
            gte(l3NodesTable.createdAt, pr.createdAt)
          )
        )
        .limit(50);

      const l2Nodes = await db
        .select({ name: l2NodesTable.name, type: l2NodesTable.type, description: l2NodesTable.description })
        .from(l2NodesTable)
        .where(
          and(
            eq(l2NodesTable.projectId, projectId),
            gte(l2NodesTable.createdAt, pr.createdAt)
          )
        )
        .limit(30);

      let aiSummary = "No knowledge graph changes were detected for this PR.";

      if (l3Nodes.length || l2Nodes.length) {
        const context = JSON.stringify({ l2Nodes, l3Nodes }, null, 2);
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          max_completion_tokens: 1024,
          messages: [
            {
              role: "system",
              content:
                "You are a technical documentation assistant. Given a list of knowledge graph changes from a PR, write a concise Markdown impact summary with sections: ## Modules Affected, ## Key Decisions, ## Summary.",
            },
            {
              role: "user",
              content: `Knowledge graph changes:\n${context}`,
            },
          ],
        });
        aiSummary = response.choices[0]?.message?.content ?? aiSummary;
      }

      await db
        .update(pullRequestsTable)
        .set({ aiSummary, analysisStatus: "completed", updatedAt: new Date() })
        .where(
          and(
            eq(pullRequestsTable.projectId, projectId),
            eq(pullRequestsTable.githubPrNumber, prNumber)
          )
        );
    } catch (err) {
      await db
        .update(pullRequestsTable)
        .set({ analysisStatus: "failed", updatedAt: new Date() })
        .where(
          and(
            eq(pullRequestsTable.projectId, projectId),
            eq(pullRequestsTable.githubPrNumber, prNumber)
          )
        )
        .catch(() => {});
    }
  });
});

function serializePr(pr: typeof pullRequestsTable.$inferSelect) {
  return {
    ...pr,
    mergedAt: pr.mergedAt?.toISOString() ?? null,
    createdAt: pr.createdAt.toISOString(),
    updatedAt: pr.updatedAt.toISOString(),
  };
}

export default router;
