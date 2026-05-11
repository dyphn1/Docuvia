import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, l1TagsTable, l2NodesTable, l2NodeL1TagsTable, l3NodesTable, commitsTable } from "@workspace/db";
import { eq, sql, count } from "drizzle-orm";

const router = Router();

router.get("/projects/:id/export", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const [l2CountRow] = await db.select({ count: count() }).from(l2NodesTable).where(eq(l2NodesTable.projectId, projectId));
  const l2Ids = await db.select({ id: l2NodesTable.id }).from(l2NodesTable).where(eq(l2NodesTable.projectId, projectId));
  let l3Count = 0;
  for (const { id } of l2Ids) {
    const [row] = await db.select({ count: count() }).from(l3NodesTable).where(eq(l3NodesTable.l2NodeId, id));
    l3Count += row.count;
  }
  const [commitCountRow] = await db.select({ count: count() }).from(commitsTable).where(eq(commitsTable.projectId, projectId));

  const l2Nodes = await db.select().from(l2NodesTable).where(eq(l2NodesTable.projectId, projectId));
  const l2WithTags = await Promise.all(l2Nodes.map(async (n) => {
    const tagLinks = await db.select().from(l2NodeL1TagsTable).where(eq(l2NodeL1TagsTable.l2NodeId, n.id));
    const [l3Row] = await db.select({ count: count() }).from(l3NodesTable).where(eq(l3NodesTable.l2NodeId, n.id));
    return { ...n, l3Count: l3Row.count, l1TagIds: tagLinks.map(t => t.l1TagId), createdAt: n.createdAt.toISOString() };
  }));

  const l3Nodes = l2Ids.length
    ? await db.select().from(l3NodesTable)
        .where(sql`${l3NodesTable.l2NodeId} IN (${sql.join(l2Ids.map(n => sql`${n.id}`), sql`, `)})`)
    : [];

  const commits = await db.select().from(commitsTable).where(eq(commitsTable.projectId, projectId))
    .orderBy(sql`${commitsTable.createdAt} desc`);

  const l1Tags = await db.select().from(l1TagsTable).orderBy(sql`${l1TagsTable.usageCount} desc`);

  const projectData = {
    ...project,
    l2Count: l2CountRow.count,
    l3Count,
    commitCount: commitCountRow.count,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };

  res.json({
    project: projectData,
    l1Tags: l1Tags.map(t => ({ ...t, createdAt: t.createdAt.toISOString() })),
    l2Nodes: l2WithTags,
    l3Nodes: l3Nodes.map(n => ({ ...n, createdAt: n.createdAt.toISOString() })),
    commits: commits.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })),
    exportedAt: new Date().toISOString(),
  });
});

export default router;
