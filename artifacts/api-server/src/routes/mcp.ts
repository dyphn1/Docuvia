import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  projectsTable,
  l2NodesTable,
  l3NodesTable,
  nodeLinksTable,
  commitsTable,
} from "@workspace/db";
import { eq, or, and, like, sql, count, isNotNull } from "drizzle-orm";
import { routeQuery } from "../lib/intent-router.js";
import { logger } from "../lib/logger.js";

const router = Router();


// Require PAT for all /mcp/* routes
router.use("/mcp", (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.MCP_PAT;
  
  if (!expectedToken) {
    logger.error("[MCP Auth] MCP_PAT environment variable is not set. Refusing all connections.");
    return res.status(500).json({ error: "Server configuration error" });
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    logger.warn({ ip: req.ip }, "[MCP Auth] Unauthorized MCP access attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});


router.get("/mcp/list_projects", async (req, res) => {
  const projects = await db
    .select()
    .from(projectsTable)
    .orderBy(sql`${projectsTable.name} asc`);
  const result = await Promise.all(
    projects.map(async (p) => {
      const [l2Row] = await db
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
      return { id: p.id, name: p.name, repoUrl: p.repoUrl, l2Count: l2Row.count, l3Count };
    })
  );
  res.json({ projects: result });
});

router.get("/mcp/search_knowledge", async (req, res) => {
  const query = String(req.query.query ?? "");
  const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;
  const limit = Math.min(Number(req.query.limit ?? 10), 50);
  const includePending = req.query.include_pending === "true";

  if (!query) return res.status(400).json({ error: "query parameter required" });

  try {
    const result = await routeQuery(query, projectId, limit, includePending);
    return res.json({ query, results: result.results.slice(0, limit) });
  } catch (err) {
    logger.error({ err }, "[GET /mcp/search_knowledge] Unhandled error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/mcp/get_dependencies", async (req, res) => {
  const moduleName = String(req.query.module ?? "");
  const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;

  if (!moduleName) return res.status(400).json({ error: "module parameter required" });

  const nodes = await db
    .select()
    .from(l2NodesTable)
    .where(like(l2NodesTable.name, `%${moduleName}%`));
  const node = projectId ? nodes.find((n) => n.projectId === projectId) : nodes[0];

  if (!node) {
    return res.json({ module: moduleName, nodeId: null, dependencies: [], dependents: [] });
  }

  const outLinks = await db
    .select()
    .from(nodeLinksTable)
    .where(eq(nodeLinksTable.sourceNodeId, node.id));
  const inLinks = await db
    .select()
    .from(nodeLinksTable)
    .where(eq(nodeLinksTable.targetNodeId, node.id));

  const dependencies = await Promise.all(
    outLinks.map(async (link) => {
      const [target] = await db
        .select({ name: l2NodesTable.name })
        .from(l2NodesTable)
        .where(eq(l2NodesTable.id, link.targetNodeId));
      return target?.name ?? `node#${link.targetNodeId}`;
    })
  );

  const dependents = await Promise.all(
    inLinks.map(async (link) => {
      const [source] = await db
        .select({ name: l2NodesTable.name })
        .from(l2NodesTable)
        .where(eq(l2NodesTable.id, link.sourceNodeId));
      return source?.name ?? `node#${link.sourceNodeId}`;
    })
  );

  return res.json({ module: moduleName, nodeId: node.id, dependencies, dependents });
});

router.get("/mcp/impact_analysis", async (req, res) => {
  const moduleName = String(req.query.module ?? "");
  const projectId = req.query.project_id ? Number(req.query.project_id) : undefined;

  if (!moduleName) return res.status(400).json({ error: "module parameter required" });

  const nodes = await db
    .select()
    .from(l2NodesTable)
    .where(like(l2NodesTable.name, `%${moduleName}%`));
  const node = projectId ? nodes.find((n) => n.projectId === projectId) : nodes[0];

  if (!node) {
    return res.json({ module: moduleName, nodeId: null, impactedModules: [], l3DecisionCount: 0 });
  }

  const inLinks = await db
    .select()
    .from(nodeLinksTable)
    .where(eq(nodeLinksTable.targetNodeId, node.id));
  const impacted = await Promise.all(
    inLinks.map(async (link) => {
      const [source] = await db
        .select({ name: l2NodesTable.name })
        .from(l2NodesTable)
        .where(eq(l2NodesTable.id, link.sourceNodeId));
      return source?.name ?? `node#${link.sourceNodeId}`;
    })
  );

  const [l3Row] = await db
    .select({ count: count() })
    .from(l3NodesTable)
    .where(eq(l3NodesTable.l2NodeId, node.id));

  return res.json({
    module: moduleName,
    nodeId: node.id,
    impactedModules: impacted,
    l3DecisionCount: l3Row.count,
  });
});

router.get("/mcp/get_decision_record", async (req, res) => {
  const commitHash = String(req.query.commit_hash ?? "");
  if (!commitHash) return res.status(400).json({ error: "commit_hash parameter required" });

  const [commit] = await db
    .select()
    .from(commitsTable)
    .where(like(commitsTable.hash, `${commitHash}%`));

  const l3Nodes = await db
    .select()
    .from(l3NodesTable)
    .where(like(l3NodesTable.commitHash, `${commitHash}%`));

  return res.json({
    commitHash,
    commitMessage: commit?.message ?? null,
    decisions: l3Nodes.map((n) => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /mcp/query — Agentic RAG intent-routing entry point
// ---------------------------------------------------------------------------

const mcpQueryBodySchema = z.object({
  q: z.string().min(1, "q is required").max(2000, "q must be 2000 characters or fewer"),
  project_id: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

router.post("/mcp/query", async (req, res) => {
  const parsed = mcpQueryBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
  }

  const { q, project_id, limit } = parsed.data;
  const includePending = req.query.include_pending === "true";

  try {
    const result = await routeQuery(q, project_id, limit, includePending);
    return res.json({ query: q, ...result });
  } catch (err) {
    logger.error({ err }, "[POST /mcp/query] Unhandled error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
