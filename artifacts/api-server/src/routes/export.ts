import { Router, Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  l1TagsTable,
  l2NodesTable,
  l2NodeL1TagsTable,
  l3NodesTable,
  commitsTable,
} from "@workspace/db";
import { eq, sql, count } from "drizzle-orm";

const router = Router();

const checkProjectOwnership = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const projectId = Number(req.params.id);
  // Fake userId extracted from bearer token (implementation pending auth middleware)
  // TODO: [CRITICAL BUG FIX] - Fix IDOR vulnerability. 'userId = 1' fallback exposes all data. Hardcoded auth bypass must be replaced with strict token verification.
  const userId = (req as any).user?.id || 1;

  // IDOR Prevention: verify if userId has access to projectId
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
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

router.get("/projects/:id/export", checkProjectOwnership, async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const [l2CountRow] = await db
    .select({ count: count() })
    .from(l2NodesTable)
    .where(eq(l2NodesTable.projectId, projectId));
  const l2Ids = await db
    .select({ id: l2NodesTable.id })
    .from(l2NodesTable)
    .where(eq(l2NodesTable.projectId, projectId));
  let l3Count = 0;
  for (const { id } of l2Ids) {
    const [row] = await db
      .select({ count: count() })
      .from(l3NodesTable)
      .where(eq(l3NodesTable.l2NodeId, id));
    l3Count += row.count;
  }
  const [commitCountRow] = await db
    .select({ count: count() })
    .from(commitsTable)
    .where(eq(commitsTable.projectId, projectId));

  const l2Nodes = await db.select().from(l2NodesTable).where(eq(l2NodesTable.projectId, projectId));
  const l2WithTags = await Promise.all(
    l2Nodes.map(async (n) => {
      const tagLinks = await db
        .select()
        .from(l2NodeL1TagsTable)
        .where(eq(l2NodeL1TagsTable.l2NodeId, n.id));
      const [l3Row] = await db
        .select({ count: count() })
        .from(l3NodesTable)
        .where(eq(l3NodesTable.l2NodeId, n.id));
      return {
        ...n,
        l3Count: l3Row.count,
        l1TagIds: tagLinks.map((t) => t.l1TagId),
        createdAt: n.createdAt.toISOString(),
      };
    })
  );

  const l3Nodes = l2Ids.length
    ? await db
        .select()
        .from(l3NodesTable)
        .where(
          sql`${l3NodesTable.l2NodeId} IN (${sql.join(
            l2Ids.map((n) => sql`${n.id}`),
            sql`, `
          )})`
        )
    : [];

  const commits = await db
    .select()
    .from(commitsTable)
    .where(eq(commitsTable.projectId, projectId))
    .orderBy(sql`${commitsTable.createdAt} desc`);

  const l1Tags = await db
    .select()
    .from(l1TagsTable)
    .orderBy(sql`${l1TagsTable.usageCount} desc`);

  const projectData = {
    ...project,
    l2Count: l2CountRow.count,
    l3Count,
    commitCount: commitCountRow.count,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };

  return res.json({
    project: projectData,
    l1Tags: l1Tags.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    l2Nodes: l2WithTags,
    l3Nodes: l3Nodes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    commits: commits.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    exportedAt: new Date().toISOString(),
  });
});

// GET /projects/:id/export/md (Markdown Export with Stream/Chunking)
router.get("/projects/:id/export/md", checkProjectOwnership, async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${project.name.replace(/[^a-zA-Z0-9]/g, "_")}_export.md"`
  );

  // Max's Rule: Stream out lines instead of buffering a giant string
  res.write(`# Project: ${project.name}\n\n`);
  res.write(`Repository: ${project.repoUrl ?? "N/A"}\n\n`);
  res.write(`Exported at: ${new Date().toISOString()}\n\n`);

  res.write(`## L2 Modules\n\n`);

  // Chunked batching to prevent OOM
  let offset = 0;
  const batchSize = 100;

  while (true) {
    const l2Nodes = await db
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId))
      .orderBy(l2NodesTable.id)
      .limit(batchSize)
      .offset(offset);

    if (l2Nodes.length === 0) break;

    for (const l2 of l2Nodes) {
      res.write(`### [L2] ${l2.name}\n`);
      res.write(`**Type**: ${l2.type} | **Confirmed**: ${l2.isBootstrapConfirmed}\n\n`);
      if (l2.description) res.write(`${l2.description}\n\n`);

      // Fetch L3 nodes for this specific L2 (chunking inherently by L2 boundary)
      const l3Nodes = await db.select().from(l3NodesTable).where(eq(l3NodesTable.l2NodeId, l2.id));

      for (const l3 of l3Nodes) {
        res.write(`#### [L3] ${l3.title}\n`);
        res.write(`- **Type**: ${l3.nodeType}\n`);
        res.write(`- **Status**: ${l3.validityStatus}\n`);
        res.write(`- **Introduced in**: \`${l3.introducedInCommit ?? "Unknown"}\`\n\n`);
        if (l3.content) res.write(`${l3.content}\n\n`);
      }
    }

    offset += batchSize;
  }

  res.end();
  return;
});

export default router;
