import { Router } from "express";
import { db } from "@workspace/db";
import { l1TagsTable, l2NodesTable, l3NodesTable, projectsTable } from "@workspace/db";
import { eq, sql, like, or } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const SearchSchema = z.object({
  query: z.string().min(1),
  projectId: z.number().optional(),
  limit: z.number().optional().default(20),
});

router.post("/search", async (req, res) => {
  const body = SearchSchema.parse(req.body);
  const { query, projectId, limit } = body;
  const pattern = `%${query}%`;
  const results: Array<{
    nodeLayer: "l1" | "l2" | "l3";
    id: number;
    title: string;
    content: string | null;
    projectId: number | null;
    projectName: string | null;
    score: number;
    createdAt: string;
  }> = [];

  const l1Rows = await db.select().from(l1TagsTable)
    .where(or(like(l1TagsTable.name, pattern), like(sql`COALESCE(${l1TagsTable.description}, '')`, pattern)))
    .limit(limit);

  for (const tag of l1Rows) {
    results.push({
      nodeLayer: "l1",
      id: tag.id,
      title: tag.name,
      content: tag.description ?? null,
      projectId: null,
      projectName: null,
      score: tag.name.toLowerCase().includes(query.toLowerCase()) ? 1.0 : 0.7,
      createdAt: tag.createdAt.toISOString(),
    });
  }

  let l2Query = db.select().from(l2NodesTable)
    .where(or(like(l2NodesTable.name, pattern), like(sql`COALESCE(${l2NodesTable.description}, '')`, pattern)))
    .$dynamic();
  if (projectId) l2Query = l2Query.where(eq(l2NodesTable.projectId, projectId));
  const l2Rows = await l2Query.limit(limit);

  const projectCache = new Map<number, string>();
  for (const node of l2Rows) {
    if (!projectCache.has(node.projectId)) {
      const [proj] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, node.projectId));
      projectCache.set(node.projectId, proj?.name ?? "Unknown");
    }
    results.push({
      nodeLayer: "l2",
      id: node.id,
      title: node.name,
      content: node.description ?? null,
      projectId: node.projectId,
      projectName: projectCache.get(node.projectId) ?? null,
      score: node.name.toLowerCase().includes(query.toLowerCase()) ? 0.9 : 0.6,
      createdAt: node.createdAt.toISOString(),
    });
  }

  const l3Rows = await db.select().from(l3NodesTable)
    .where(or(like(l3NodesTable.title, pattern), like(sql`COALESCE(${l3NodesTable.content}, '')`, pattern)))
    .limit(limit);

  for (const node of l3Rows) {
    const [l2] = await db.select().from(l2NodesTable).where(eq(l2NodesTable.id, node.l2NodeId));
    const projId = l2?.projectId ?? null;
    if (projectId && projId !== projectId) continue;
    if (projId && !projectCache.has(projId)) {
      const [proj] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projId));
      projectCache.set(projId, proj?.name ?? "Unknown");
    }
    results.push({
      nodeLayer: "l3",
      id: node.id,
      title: node.title,
      content: node.content ?? null,
      projectId: projId,
      projectName: projId ? (projectCache.get(projId) ?? null) : null,
      score: node.title.toLowerCase().includes(query.toLowerCase()) ? 0.85 : 0.55,
      createdAt: node.createdAt.toISOString(),
    });
  }

  results.sort((a, b) => b.score - a.score);
  const limited = results.slice(0, limit);

  res.json({ results: limited, total: results.length });
});

export default router;
