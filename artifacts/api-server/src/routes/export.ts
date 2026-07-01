import { Router, Request, Response, NextFunction } from "express";
import { ProjectService } from "../services/project.service";
import { db } from "@workspace/db";
import {
  projectsTable,
  l1TagsTable,
  l2NodesTable,
  l2NodeL1TagsTable,
  l3NodesTable,
  commitsTable,
} from "@workspace/db";
import { eq, sql, count, inArray } from "drizzle-orm";
import { requireApiKey } from "../middlewares/auth";

const router = Router();

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
    const project = await new ProjectService().getProjectById(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const [l2CountRow] = await db
      .select({ count: count() })
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId));
    const l2Nodes = await db
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId))
      .orderBy(l2NodesTable.id);
    const l2Ids = l2Nodes.map((n) => n.id);

    const [[l3CountRow], [commitCountRow]] = await Promise.all([
      db
        .select({ count: count() })
        .from(l3NodesTable)
        .where(inArray(l3NodesTable.l2NodeId, l2Ids.length ? l2Ids : [0])),
      db.select({ count: count() }).from(commitsTable).where(eq(commitsTable.projectId, projectId)),
    ]);
    const l3Count = l2Ids.length ? l3CountRow.count : 0;

    const [tagLinkRows, l3Counts] = await Promise.all([
      l2Ids.length
        ? db.select().from(l2NodeL1TagsTable).where(inArray(l2NodeL1TagsTable.l2NodeId, l2Ids))
        : [],
      l2Ids.length
        ? db
            .select({ l2NodeId: l3NodesTable.l2NodeId, count: count() })
            .from(l3NodesTable)
            .where(inArray(l3NodesTable.l2NodeId, l2Ids))
            .groupBy(l3NodesTable.l2NodeId)
        : [],
    ]);
    const l3CountMap = new Map(l3Counts.map((r) => [r.l2NodeId, r.count]));
    const tagLinksByL2 = new Map<number, number[]>();
    for (const link of tagLinkRows) {
      const ids = tagLinksByL2.get(link.l2NodeId);
      if (ids) ids.push(link.l1TagId);
      else tagLinksByL2.set(link.l2NodeId, [link.l1TagId]);
    }
    const l2WithTags = l2Nodes.map((n) => ({
      ...n,
      l3Count: l3CountMap.get(n.id) ?? 0,
      l1TagIds: tagLinksByL2.get(n.id) ?? [],
      createdAt: n.createdAt.toISOString(),
    }));

    const l3Nodes = l2Ids.length
      ? await db.select().from(l3NodesTable).where(inArray(l3NodesTable.l2NodeId, l2Ids))
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

      const l2IdList = l2Nodes.map((n) => n.id);
      const allL3 = l2IdList.length
        ? await db.select().from(l3NodesTable).where(inArray(l3NodesTable.l2NodeId, l2IdList))
        : [];
      const l3ByL2 = new Map<number, typeof allL3>();
      for (const l3 of allL3) {
        const group = l3ByL2.get(l3.l2NodeId);
        if (group) group.push(l3);
        else l3ByL2.set(l3.l2NodeId, [l3]);
      }

      for (const l2 of l2Nodes) {
        res.write(`### [L2] ${l2.name}\n`);
        res.write(`**Type**: ${l2.type} | **Confirmed**: ${l2.isBootstrapConfirmed}\n\n`);
        if (l2.description) res.write(`${l2.description}\n\n`);

        const l3Nodes = l3ByL2.get(l2.id) ?? [];
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
  }
);

export default router;
