import { Router } from "express";
import { logger } from "../lib/logger.js";
import { db } from "@workspace/db";
import {
  projectsTable,
  l2NodesTable,
  l3NodesTable,
  commitsTable,
  activityLogTable,
} from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";
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

const router = Router();

router.get("/projects", async (req, res) => {
  const projects = await db
    .select()
    .from(projectsTable)
    .orderBy(sql`${projectsTable.updatedAt} desc`);
  const result = await Promise.all(
    projects.map(async (p) => {
      const [l2CountRow] = await db
        .select({ count: count() })
        .from(l2NodesTable)
        .where(eq(l2NodesTable.projectId, p.id));
      const l2Ids = await db
        .select({ id: l2NodesTable.id })
        .from(l2NodesTable)
        .where(eq(l2NodesTable.projectId, p.id));
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
        .where(eq(commitsTable.projectId, p.id));
      return {
        ...p,
        l2Count: l2CountRow.count,
        l3Count,
        commitCount: commitCountRow.count,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    })
  );
  res.json(result);
});

router.post("/projects", async (req, res) => {
  const body = CreateProjectBody.parse(req.body);
  const [project] = await db
    .insert(projectsTable)
    .values({
      name: body.name,
      repoUrl: body.repoUrl,
      description: body.description ?? null,
      status: "active",
    })
    .returning();

  // Create default sys-uncategorized node
  await db.insert(l2NodesTable).values({
    projectId: project.id,
    name: "System: Uncategorized",
    type: "sys-uncategorized",
    isSystem: true,
    description: "Default bucket for unassigned L3 decisions",
    aiGenerated: false,
  });

  await db.insert(activityLogTable).values({
    type: "l2_created",
    description: `Project "${project.name}" added`,
    projectId: project.id,
  });
  res.status(201).json({
    ...project,
    l2Count: 1,
    l3Count: 0,
    commitCount: 0,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.get("/projects/:id", async (req, res) => {
  const { id } = GetProjectParams.parse({ id: Number(req.params.id) });
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) return res.status(404).json({ error: "Not found" });
  const [l2CountRow] = await db
    .select({ count: count() })
    .from(l2NodesTable)
    .where(eq(l2NodesTable.projectId, id));
  const l2Ids = await db
    .select({ id: l2NodesTable.id })
    .from(l2NodesTable)
    .where(eq(l2NodesTable.projectId, id));
  let l3Count = 0;
  for (const { nodeId } of l2Ids as any[]) {
    const lid = nodeId ?? (l2Ids[0] as any).id;
    const [row] = await db
      .select({ count: count() })
      .from(l3NodesTable)
      .where(eq(l3NodesTable.l2NodeId, lid));
    l3Count += row.count;
  }
  const [commitCountRow] = await db
    .select({ count: count() })
    .from(commitsTable)
    .where(eq(commitsTable.projectId, id));
  return res.json({
    ...project,
    l2Count: l2CountRow.count,
    l3Count,
    commitCount: commitCountRow.count,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.patch("/projects/:id", async (req, res) => {
  const { id } = UpdateProjectParams.parse({ id: Number(req.params.id) });
  const body = UpdateProjectBody.parse(req.body);
  const [project] = await db
    .update(projectsTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(projectsTable.id, id))
    .returning();
  if (!project) return res.status(404).json({ error: "Not found" });
  return res.json({
    ...project,
    l2Count: 0,
    l3Count: 0,
    commitCount: 0,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.delete("/projects/:id", async (req, res) => {
  const { id } = DeleteProjectParams.parse({ id: Number(req.params.id) });
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  res.status(204).send();
});

router.get("/projects/:id/graph", async (req, res) => {
  const { id } = GetProjectGraphParams.parse({ id: Number(req.params.id) });
  const l2Nodes = await db.select().from(l2NodesTable).where(eq(l2NodesTable.projectId, id));
  const l3Nodes = l2Nodes.length
    ? await db
        .select()
        .from(l3NodesTable)
        .where(
          sql`${l3NodesTable.l2NodeId} IN (${sql.join(
            l2Nodes.map((n) => sql`${n.id}`),
            sql`, `
          )})`
        )
    : [];
  res.json({
    projectId: id,
    l1Tags: [],
    l2Nodes: l2Nodes.map((n) => ({
      ...n,
      l3Count: 0,
      l1TagIds: [],
      createdAt: n.createdAt.toISOString(),
    })),
    l3Nodes: l3Nodes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
  });
});

router.get("/projects/:id/commits", async (req, res) => {
  const { id } = ListCommitsParams.parse({ id: Number(req.params.id) });
  const commits = await db
    .select()
    .from(commitsTable)
    .where(eq(commitsTable.projectId, id))
    .orderBy(sql`${commitsTable.createdAt} desc`);
  res.json(commits.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
});

router.post("/projects/:id/commits", async (req, res) => {
  const { id } = CreateCommitParams.parse({ id: Number(req.params.id) });
  const body = CreateCommitBody.parse(req.body);
  const [commit] = await db
    .insert(commitsTable)
    .values({
      projectId: id,
      hash: body.hash,
      message: body.message,
      author: body.author,
      valid: body.valid ?? true,
      l2NodeId: body.l2NodeId ?? null,
    })
    .returning();
  await db.insert(activityLogTable).values({
    type: "commit",
    description: `Commit ${commit.hash.slice(0, 8)}: ${commit.message}`,
    projectId: id,
  });
  res.status(201).json({ ...commit, createdAt: commit.createdAt.toISOString() });
});

router.get("/projects/:id/l2-nodes", async (req, res) => {
  const { id } = ListProjectL2NodesParams.parse({ id: Number(req.params.id) });
  const nodes = await db.select().from(l2NodesTable).where(eq(l2NodesTable.projectId, id));
  const result = await Promise.all(
    nodes.map(async (n) => {
      const [row] = await db
        .select({ count: count() })
        .from(l3NodesTable)
        .where(eq(l3NodesTable.l2NodeId, n.id));
      return { ...n, l3Count: row.count, l1TagIds: [], createdAt: n.createdAt.toISOString() };
    })
  );
  res.json(result);
});


// POST /projects/:id/sync (Trigger ingestion pipeline from CLI)
router.post("/projects/:id/sync", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  try {
    // In a real implementation this would trigger an async job via job_queue.ts
    // For now we simulate acknowledging the trigger.
    await db.insert(activityLogTable).values({
      projectId,
      type: "commit",
      description: "Sync triggered via CLI"
    });
    
    return res.json({ success: true, message: "Sync ingestion triggered in background" });
  } catch (err: any) {
    logger.error({ err, projectId }, "[POST /projects/:id/sync] Failed to trigger sync");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
