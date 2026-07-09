import { ENCODING_UTF_8, UTF8_ENCODING } from "@workspace/core";
import { API_MESSAGES } from "@workspace/core";
import { Router } from "express";
import { z } from "zod";
import {
  DependencyService,
  ImpactAnalysisService,
  ProjectService,
  DecisionRecordService,
} from "@workspace/core";
import { routeQuery, sanitizeLikeInput } from "@workspace/core";
import { logger } from "@workspace/core";
import { getAllMemories, getCompressedPayload } from "../memory/shared-memory.js";
import {
  McpGetDependenciesQueryParams,
  McpGetDecisionRecordQueryParams,
  McpImpactAnalysisQueryParams,
  McpQueryBody as GeneratedMcpQueryBody,
} from "@workspace/api-zod";
import crypto from "crypto";
import { validateQuery, validateBody } from "../middlewares/validate.js";

const router = Router();

const RetrieveOriginalQuery = z.object({
  id: z.coerce.string().min(1, "id is required"),
});

const SearchKnowledgeQuery = z.object({
  query: z.coerce.string().min(1, "query is required"),
  project_id: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  include_pending: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

const McpQueryRequestBody = GeneratedMcpQueryBody.extend({
  include_pending: z.boolean().optional().default(false),
});

// Require PAT for all /mcp/* routes
router.use("/mcp", (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.MCP_PAT;

  if (!expectedToken) {
    logger.error("[MCP Auth] MCP_PAT environment variable is not set. Refusing all connections.");
    return res.status(500).json({ error: API_MESSAGES.SERVER_CONFIGURATION_ERROR });
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn({ ip: req.ip }, "[MCP Auth] Missing or malformed Authorization header");
    return res.status(401).json({ error: API_MESSAGES.UNAUTHORIZED });
  }

  const providedToken = authHeader.substring(7);

  // To avoid crypto.timingSafeEqual crashing on length mismatch, we must verify lengths first
  if (
    Buffer.byteLength(providedToken, UTF8_ENCODING) !==
      Buffer.byteLength(expectedToken, UTF8_ENCODING) ||
    !crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(expectedToken))
  ) {
    logger.warn({ ip: req.ip }, "[MCP Auth] Unauthorized MCP access attempt");
    return res.status(401).json({ error: API_MESSAGES.UNAUTHORIZED });
  }

  next();
  return;
});

router.get("/mcp/list_projects", async (req, res) => {
  const result = await ProjectService.listProjects();
  res.json({ projects: result });
});

router.get("/mcp/read_shared_memory", async (req, res) => {
  try {
    const memories = getAllMemories();
    return res.json({ memories });
  } catch (err) {
    logger.error({ err }, "[GET /mcp/read_shared_memory] Error reading shared memory");
    return res.status(500).json({ error: API_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

router.get("/mcp/retrieve_original", validateQuery(RetrieveOriginalQuery), async (req, res) => {
  const { id } = res.locals.validatedQuery as z.infer<typeof RetrieveOriginalQuery>;

  try {
    const payload = getCompressedPayload(id);
    if (!payload) return res.status(404).json({ error: API_MESSAGES.NOT_FOUND });

    return res.json({ id, original_text: payload.original_text });
  } catch (err) {
    logger.error({ err }, "[GET /mcp/retrieve_original] Error retrieving original payload");
    return res.status(500).json({ error: API_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

router.get("/mcp/search_knowledge", validateQuery(SearchKnowledgeQuery), async (req, res) => {
  const {
    query,
    project_id: projectId,
    limit,
    include_pending,
  } = res.locals.validatedQuery as z.infer<typeof SearchKnowledgeQuery>;
  const includePending = include_pending;

  try {
    const result = await routeQuery(query, projectId, limit, includePending);
    return res.json({ query, results: result.results.slice(0, limit) });
  } catch (err) {
    logger.error({ err }, "[GET /mcp/search_knowledge] Unhandled error");
    return res.status(500).json({ error: API_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

router.get(
  "/mcp/get_dependencies",
  validateQuery(McpGetDependenciesQueryParams),
  async (req, res) => {
    const { module: moduleName, project_id: projectId } = res.locals.validatedQuery as z.infer<
      typeof McpGetDependenciesQueryParams
    >;
    const escapedModuleName = sanitizeLikeInput(moduleName);

    const result = await DependencyService.getDependencies(
      moduleName,
      escapedModuleName,
      projectId
    );
    return res.json(result);
  }
);

router.get(
  "/mcp/impact_analysis",
  validateQuery(McpImpactAnalysisQueryParams),
  async (req, res) => {
    const { module: moduleName, project_id: projectId } = res.locals.validatedQuery as z.infer<
      typeof McpImpactAnalysisQueryParams
    >;
    const escapedModuleName = sanitizeLikeInput(moduleName);

    const result = await ImpactAnalysisService.analyzeImpact(
      moduleName,
      escapedModuleName,
      projectId
    );
    return res.json(result);
  }
);

router.get(
  "/mcp/get_decision_record",
  validateQuery(McpGetDecisionRecordQueryParams),
  async (req, res) => {
    const { commit_hash: commitHash } = res.locals.validatedQuery as z.infer<
      typeof McpGetDecisionRecordQueryParams
    >;
    const escapedCommitHash = sanitizeLikeInput(commitHash);

    const result = await DecisionRecordService.getDecisionRecord(commitHash, escapedCommitHash);
    return res.json(result);
  }
);

// ---------------------------------------------------------------------------
// POST /mcp/query — Agentic RAG intent-routing entry point
// ---------------------------------------------------------------------------

router.post("/mcp/query", validateBody(McpQueryRequestBody), async (req, res) => {
  const {
    q,
    project_id,
    limit,
    include_pending: includePending,
  } = res.locals.validatedBody as z.infer<typeof McpQueryRequestBody>;

  try {
    const result = await routeQuery(q, project_id, limit, includePending);
    return res.json({ query: q, ...result });
  } catch (err) {
    logger.error({ err }, "[POST /mcp/query] Unhandled error");
    return res.status(500).json({ error: API_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// GET /mcp/tools — Tool discovery endpoint
router.get("/mcp/tools", (_req, res) => {
  res.json({
    tools: [
      {
        name: "list_projects",
        description: "List all projects in the workspace",
        method: "GET",
        path: "/mcp/list-projects",
      },
      {
        name: "query",
        description:
          "Query the knowledge graph using intent routing (vector search / graph traversal / direct lookup / hybrid)",
        method: "POST",
        path: "/mcp/query",
        params: {
          query: "string",
          project_id: "number?",
          limit: "number?",
          include_pending: "boolean?",
        },
      },
      {
        name: "search_knowledge",
        description: "Keyword search across L2 nodes and L3 decisions",
        method: "GET",
        path: "/mcp/search-knowledge",
        params: { query: "string", project_id: "number?", limit: "number?" },
      },
      {
        name: "get_dependencies",
        description: "Get dependency graph for a node (impact analysis)",
        method: "GET",
        path: "/mcp/get-dependencies",
        params: { node_id: "number" },
      },
      {
        name: "get_decision_record",
        description: "Retrieve a specific L3 decision by ID",
        method: "GET",
        path: "/mcp/get-decision-record",
        params: { id: "number" },
      },
      {
        name: "impact_analysis",
        description: "Analyze propagation paths from a starting node through link graph",
        method: "GET",
        path: "/mcp/impact-analysis",
        params: { start_node_id: "number", max_depth: "number?" },
      },
      {
        name: "retrieve_original_query",
        description: "Retrieve an original query by its stored memory ID",
        method: "GET",
        path: "/mcp/retrieve-original-query",
        params: { id: "string" },
      },
      {
        name: "list_commits",
        description: "List recent commits for a project",
        method: "GET",
        path: "/mcp/list-commits",
        params: { project_id: "number", limit: "number?" },
      },
    ],
  });
});

export { router as mcpRouter };
