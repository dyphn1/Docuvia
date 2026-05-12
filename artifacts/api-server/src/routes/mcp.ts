import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, l2NodesTable, l3NodesTable, nodeLinksTable, commitsTable } from "@workspace/db";
import { eq, or, like, sql, count, isNotNull } from "drizzle-orm";
import { generateEmbedding, cosineSimilarity, parseEmbedding } from "../lib/embedding.js";

const router = Router();

router.get("/mcp/list_projects", async (req, res) => {
  const projects = await db.select().from(projectsTable).orderBy(sql`${projectsTable.name} asc`);
  const result = await Promise.all(projects.map(async (p) => {
    const [l2Row] = await db.select({ count: count() }).from(l2NodesTable).where(eq(l2NodesTable.projectId, p.id));
    const l2Ids = await db.select({ id: l2NodesTable.id }).from(l2NodesTable).where(eq(l2NodesTable.projectId, p.id));
    let l3Count = 0;
    for (const { id } of l2Ids) {
      const [row] = await db.select({ count: count() }).from(l3NodesTable).where(eq(l3NodesTable.l2NodeId, id));
      l3Count += row.count;
    }
    return { id: p.id, name: p.name, repoUrl: p.repoUrl, l2Count: l2Row.count, l3Count };
  }));
  res.json({ projects: result });
});

router.get("/mcp/search_knowledge", async (req, res) => {
  const query = String(req.query.query ?? "");
  const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;
  const limit = Math.min(Number(req.query.limit ?? 10), 50);

  if (!query) return res.status(400).json({ error: "query parameter required" });

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

  const queryEmbedding = await generateEmbedding(query);

  if (queryEmbedding) {
    // --- Semantic search: L2 nodes ---
    let l2SemanticQuery = db.select().from(l2NodesTable)
      .where(isNotNull(l2NodesTable.embedding))
      .$dynamic();
    if (projectId) l2SemanticQuery = l2SemanticQuery.where(eq(l2NodesTable.projectId, projectId));
    const l2WithEmb = await l2SemanticQuery;

    const l2Scored = l2WithEmb
      .map((node) => {
        const emb = parseEmbedding(node.embedding);
        const score = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        return { node, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const { node, score } of l2Scored) {
      const [proj] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, node.projectId));
      results.push({
        nodeLayer: "l2",
        id: node.id,
        title: node.name,
        content: node.description ?? null,
        projectId: node.projectId,
        projectName: proj?.name ?? null,
        score,
        createdAt: node.createdAt.toISOString(),
      });
    }

    // --- Semantic search: L3 nodes ---
    const l3WithEmb = await db.select().from(l3NodesTable).where(isNotNull(l3NodesTable.embedding));

    const l3Scored = l3WithEmb
      .map((node) => {
        const emb = parseEmbedding(node.embedding);
        const score = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        return { node, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const { node, score } of l3Scored) {
      results.push({
        nodeLayer: "l3",
        id: node.id,
        title: node.title,
        content: node.content ?? null,
        projectId: null,
        projectName: null,
        score,
        createdAt: node.createdAt.toISOString(),
      });
    }
  } else {
    // --- Fallback: SQL LIKE search ---
    const pattern = `%${query}%`;

    let l2FallbackQuery = db.select().from(l2NodesTable)
      .where(or(like(l2NodesTable.name, pattern), like(sql`COALESCE(${l2NodesTable.description}, '')`, pattern)))
      .$dynamic();
    if (projectId) l2FallbackQuery = l2FallbackQuery.where(eq(l2NodesTable.projectId, projectId));
    const l2Rows = await l2FallbackQuery.limit(limit);

    for (const node of l2Rows) {
      const [proj] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, node.projectId));
      results.push({
        nodeLayer: "l2",
        id: node.id,
        title: node.name,
        content: node.description ?? null,
        projectId: node.projectId,
        projectName: proj?.name ?? null,
        score: 0.9,
        createdAt: node.createdAt.toISOString(),
      });
    }

    const l3Rows = await db.select().from(l3NodesTable)
      .where(or(like(l3NodesTable.title, pattern), like(sql`COALESCE(${l3NodesTable.content}, '')`, pattern)))
      .limit(limit);

    for (const node of l3Rows) {
      results.push({
        nodeLayer: "l3",
        id: node.id,
        title: node.title,
        content: node.content ?? null,
        projectId: null,
        projectName: null,
        score: 0.8,
        createdAt: node.createdAt.toISOString(),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  res.json({ query, results: results.slice(0, limit) });
});

router.get("/mcp/get_dependencies", async (req, res) => {
  const moduleName = String(req.query.module ?? "");
  const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;

  if (!moduleName) return res.status(400).json({ error: "module parameter required" });

  const nodes = await db.select().from(l2NodesTable)
    .where(like(l2NodesTable.name, `%${moduleName}%`));
  const node = projectId ? nodes.find(n => n.projectId === projectId) : nodes[0];

  if (!node) {
    return res.json({ module: moduleName, nodeId: null, dependencies: [], dependents: [] });
  }

  const outLinks = await db.select().from(nodeLinksTable).where(eq(nodeLinksTable.sourceNodeId, node.id));
  const inLinks = await db.select().from(nodeLinksTable).where(eq(nodeLinksTable.targetNodeId, node.id));

  const dependencies = await Promise.all(outLinks.map(async (link) => {
    const [target] = await db.select({ name: l2NodesTable.name }).from(l2NodesTable).where(eq(l2NodesTable.id, link.targetNodeId));
    return target?.name ?? `node#${link.targetNodeId}`;
  }));

  const dependents = await Promise.all(inLinks.map(async (link) => {
    const [source] = await db.select({ name: l2NodesTable.name }).from(l2NodesTable).where(eq(l2NodesTable.id, link.sourceNodeId));
    return source?.name ?? `node#${link.sourceNodeId}`;
  }));

  res.json({ module: moduleName, nodeId: node.id, dependencies, dependents });
});

router.get("/mcp/impact_analysis", async (req, res) => {
  const moduleName = String(req.query.module ?? "");
  const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;

  if (!moduleName) return res.status(400).json({ error: "module parameter required" });

  const nodes = await db.select().from(l2NodesTable)
    .where(like(l2NodesTable.name, `%${moduleName}%`));
  const node = projectId ? nodes.find(n => n.projectId === projectId) : nodes[0];

  if (!node) {
    return res.json({ module: moduleName, nodeId: null, impactedModules: [], l3DecisionCount: 0 });
  }

  const inLinks = await db.select().from(nodeLinksTable).where(eq(nodeLinksTable.targetNodeId, node.id));
  const impacted = await Promise.all(inLinks.map(async (link) => {
    const [source] = await db.select({ name: l2NodesTable.name }).from(l2NodesTable).where(eq(l2NodesTable.id, link.sourceNodeId));
    return source?.name ?? `node#${link.sourceNodeId}`;
  }));

  const [l3Row] = await db.select({ count: count() }).from(l3NodesTable).where(eq(l3NodesTable.l2NodeId, node.id));

  res.json({ module: moduleName, nodeId: node.id, impactedModules: impacted, l3DecisionCount: l3Row.count });
});

router.get("/mcp/get_decision_record", async (req, res) => {
  const commitHash = String(req.query.commit_hash ?? "");
  if (!commitHash) return res.status(400).json({ error: "commit_hash parameter required" });

  const [commit] = await db.select().from(commitsTable).where(like(commitsTable.hash, `${commitHash}%`));

  const l3Nodes = await db.select().from(l3NodesTable)
    .where(like(l3NodesTable.commitHash, `${commitHash}%`));

  res.json({
    commitHash,
    commitMessage: commit?.message ?? null,
    decisions: l3Nodes.map(n => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

export default router;
