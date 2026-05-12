import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import {
  projectsTable,
  l2NodesTable,
  l3NodesTable,
  nodeLinksTable,
  commitsTable,
} from "@workspace/db";
import { eq, like, isNotNull, or, sql } from "drizzle-orm";
import { generateEmbedding, cosineSimilarity, parseEmbedding } from "./embedding.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoutingStrategy =
  | "vector_search"
  | "graph_traversal"
  | "direct_lookup"
  | "hybrid";

export interface IntentClassification {
  strategy: RoutingStrategy;
  entities: {
    moduleName?: string | null;
    commitHash?: string | null;
    searchQuery?: string | null;
  };
  confidence: number;
  reasoning: string;
}

export interface AgenticSearchResult {
  source: "vector" | "graph" | "direct";
  nodeLayer: "l1" | "l2" | "l3" | "commit";
  id: number | string;
  title: string;
  content: string | null;
  projectId: number | null;
  projectName: string | null;
  score: number;
  createdAt: string;
}

export interface RouteQueryResult {
  routingStrategy: RoutingStrategy;
  entities: IntentClassification["entities"];
  results: AgenticSearchResult[];
  metadata: {
    classificationConfidence: number;
    reasoning: string;
    durationMs: number;
  };
}

// ---------------------------------------------------------------------------
// Intent Classification
// ---------------------------------------------------------------------------

const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for a software knowledge graph query system.

Given a natural language query, classify the user's intent into exactly one of these strategies:
- "vector_search": The user wants to find conceptually related modules, documents, or decisions by topic/similarity.
- "graph_traversal": The user wants to know dependencies, dependents, or impact of a specific named module/component.
- "direct_lookup": The user is looking for a specific commit hash or decision record by exact identifier.
- "hybrid": The user wants both semantic discovery AND structural relationships (e.g., "find auth modules AND their dependencies").

Also extract:
- moduleName: if the query references a specific named module/component
- commitHash: if the query references a commit hash (hex string 4-40 chars)
- searchQuery: a cleaned-up search phrase for semantic search (omit filler words)

Return ONLY valid JSON with this exact shape:
{
  "strategy": "<strategy>",
  "entities": {
    "moduleName": "<string or null>",
    "commitHash": "<string or null>",
    "searchQuery": "<string or null>"
  },
  "confidence": <0.0-1.0>,
  "reasoning": "<one sentence>"
}`;

const VALID_STRATEGIES = new Set<string>([
  "vector_search",
  "graph_traversal",
  "direct_lookup",
  "hybrid",
]);

/**
 * Sanitize user query before sending to LLM to prevent prompt injection.
 * Strips characters that could escape JSON or inject instructions.
 */
function sanitizeQuery(query: string): string {
  return query
    .slice(0, 2000)
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim();
}

export async function classifyIntent(query: string): Promise<IntentClassification> {
  const sanitized = sanitizeQuery(query);
  const fallback: IntentClassification = {
    strategy: "vector_search",
    entities: { searchQuery: sanitized },
    confidence: 0.5,
    reasoning: "Fallback to vector_search due to classification failure.",
  };

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
        { role: "user", content: sanitized },
      ],
      max_tokens: 256,
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const strategy = parsed.strategy as string;
    if (!VALID_STRATEGIES.has(strategy)) return fallback;

    const entities = (parsed.entities ?? {}) as Record<string, unknown>;
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;
    const reasoning =
      typeof parsed.reasoning === "string" ? parsed.reasoning : "";

    return {
      strategy: strategy as RoutingStrategy,
      entities: {
        moduleName:
          typeof entities.moduleName === "string" ? entities.moduleName : null,
        commitHash:
          typeof entities.commitHash === "string" ? entities.commitHash : null,
        searchQuery:
          typeof entities.searchQuery === "string" ? entities.searchQuery : sanitized,
      },
      confidence,
      reasoning,
    };
  } catch (err) {
    logger.warn({ err }, "[intent-router] classifyIntent failed, falling back to vector_search");
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Handler: Vector Search
// ---------------------------------------------------------------------------

export async function vectorSearchHandler(
  query: string,
  projectId?: number,
  limit = 10
): Promise<AgenticSearchResult[]> {
  const results: AgenticSearchResult[] = [];
  const queryEmbedding = await generateEmbedding(query);

  if (queryEmbedding) {
    // Semantic search: L2 nodes
    let l2Query = db
      .select()
      .from(l2NodesTable)
      .where(isNotNull(l2NodesTable.embedding))
      .$dynamic();
    if (projectId) l2Query = l2Query.where(eq(l2NodesTable.projectId, projectId));
    const l2Rows = await l2Query;

    const l2Scored = l2Rows
      .map((node) => {
        const emb = parseEmbedding(node.embedding);
        const score = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        return { node, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const { node, score } of l2Scored) {
      const [proj] = await db
        .select({ name: projectsTable.name })
        .from(projectsTable)
        .where(eq(projectsTable.id, node.projectId));
      results.push({
        source: "vector",
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

    // Semantic search: L3 nodes
    const l3Rows = await db
      .select()
      .from(l3NodesTable)
      .where(isNotNull(l3NodesTable.embedding));

    const l3Scored = l3Rows
      .map((node) => {
        const emb = parseEmbedding(node.embedding);
        const score = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        return { node, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const { node, score } of l3Scored) {
      results.push({
        source: "vector",
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
    // Fallback: SQL LIKE search
    const pattern = `%${query}%`;

    let l2FallbackQuery = db
      .select()
      .from(l2NodesTable)
      .where(
        or(
          like(l2NodesTable.name, pattern),
          like(sql`COALESCE(${l2NodesTable.description}, '')`, pattern)
        )
      )
      .$dynamic();
    if (projectId) l2FallbackQuery = l2FallbackQuery.where(eq(l2NodesTable.projectId, projectId));
    const l2Rows = await l2FallbackQuery.limit(limit);

    for (const node of l2Rows) {
      const [proj] = await db
        .select({ name: projectsTable.name })
        .from(projectsTable)
        .where(eq(projectsTable.id, node.projectId));
      results.push({
        source: "vector",
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

    const l3Rows = await db
      .select()
      .from(l3NodesTable)
      .where(
        or(
          like(l3NodesTable.title, pattern),
          like(sql`COALESCE(${l3NodesTable.content}, '')`, pattern)
        )
      )
      .limit(limit);

    for (const node of l3Rows) {
      results.push({
        source: "vector",
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
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Handler: Graph Traversal
// ---------------------------------------------------------------------------

export async function graphTraversalHandler(
  moduleName: string,
  projectId?: number
): Promise<AgenticSearchResult[]> {
  const results: AgenticSearchResult[] = [];

  const nodes = await db
    .select()
    .from(l2NodesTable)
    .where(like(l2NodesTable.name, `%${moduleName}%`));
  const node = projectId ? nodes.find((n) => n.projectId === projectId) : nodes[0];

  if (!node) return results;

  const [proj] = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, node.projectId));

  // The matched node itself
  results.push({
    source: "graph",
    nodeLayer: "l2",
    id: node.id,
    title: node.name,
    content: node.description ?? null,
    projectId: node.projectId,
    projectName: proj?.name ?? null,
    score: 1.0,
    createdAt: node.createdAt.toISOString(),
  });

  // Outbound dependencies
  const outLinks = await db
    .select()
    .from(nodeLinksTable)
    .where(eq(nodeLinksTable.sourceNodeId, node.id));

  for (const link of outLinks) {
    const [target] = await db
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.id, link.targetNodeId));
    if (!target) continue;
    const [targetProj] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, target.projectId));
    results.push({
      source: "graph",
      nodeLayer: "l2",
      id: target.id,
      title: target.name,
      content: target.description ?? null,
      projectId: target.projectId,
      projectName: targetProj?.name ?? null,
      score: 0.7,
      createdAt: target.createdAt.toISOString(),
    });
  }

  // Inbound dependents
  const inLinks = await db
    .select()
    .from(nodeLinksTable)
    .where(eq(nodeLinksTable.targetNodeId, node.id));

  for (const link of inLinks) {
    const [source] = await db
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.id, link.sourceNodeId));
    if (!source) continue;
    const [sourceProj] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, source.projectId));
    results.push({
      source: "graph",
      nodeLayer: "l2",
      id: source.id,
      title: source.name,
      content: source.description ?? null,
      projectId: source.projectId,
      projectName: sourceProj?.name ?? null,
      score: 0.7,
      createdAt: source.createdAt.toISOString(),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Handler: Direct Lookup
// ---------------------------------------------------------------------------

export async function directLookupHandler(
  commitHash: string
): Promise<AgenticSearchResult[]> {
  const results: AgenticSearchResult[] = [];

  const [commit] = await db
    .select()
    .from(commitsTable)
    .where(like(commitsTable.hash, `${commitHash}%`));

  if (commit) {
    const [proj] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, commit.projectId));
    results.push({
      source: "direct",
      nodeLayer: "commit",
      id: commit.id,
      title: commit.hash,
      content: commit.message,
      projectId: commit.projectId,
      projectName: proj?.name ?? null,
      score: 1.0,
      createdAt: commit.createdAt.toISOString(),
    });
  }

  const l3Nodes = await db
    .select()
    .from(l3NodesTable)
    .where(like(l3NodesTable.commitHash, `${commitHash}%`));

  for (const node of l3Nodes) {
    results.push({
      source: "direct",
      nodeLayer: "l3",
      id: node.id,
      title: node.title,
      content: node.content ?? null,
      projectId: null,
      projectName: null,
      score: 1.0,
      createdAt: node.createdAt.toISOString(),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Hybrid Search
// ---------------------------------------------------------------------------

async function hybridSearch(
  query: string,
  classification: IntentClassification,
  projectId?: number,
  limit = 10
): Promise<AgenticSearchResult[]> {
  const searchQuery = classification.entities.searchQuery ?? query;

  // Step 1: vector search
  const vectorResults = await vectorSearchHandler(searchQuery, projectId, limit);

  // Step 2: extract unique L2 node names from top-3 vector results
  const topL2Names = vectorResults
    .filter((r) => r.nodeLayer === "l2")
    .slice(0, 3)
    .map((r) => r.title);

  // Step 3: graph traversal for each unique L2 name
  const graphResultArrays = await Promise.all(
    topL2Names.map((name) => graphTraversalHandler(name, projectId))
  );
  const graphResults = graphResultArrays.flat();

  // Step 4: merge and deduplicate by (nodeLayer, id)
  const seen = new Set<string>();
  const merged: AgenticSearchResult[] = [];

  for (const r of [...vectorResults, ...graphResults]) {
    const key = `${r.nodeLayer}:${r.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }

  // Step 5: re-rank and return top limit
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Top-level Orchestrator
// ---------------------------------------------------------------------------

export async function routeQuery(
  query: string,
  projectId?: number,
  limit = 10
): Promise<RouteQueryResult> {
  const start = Date.now();

  const classification = await classifyIntent(query);

  logger.info(
    {
      strategy: classification.strategy,
      confidence: classification.confidence,
      entities: classification.entities,
    },
    "[intent-router] query classified"
  );

  let results: AgenticSearchResult[];

  switch (classification.strategy) {
    case "graph_traversal": {
      const moduleName = classification.entities.moduleName ?? query;
      results = await graphTraversalHandler(moduleName, projectId);
      break;
    }
    case "direct_lookup": {
      const commitHash = classification.entities.commitHash ?? query;
      results = await directLookupHandler(commitHash);
      break;
    }
    case "hybrid": {
      results = await hybridSearch(query, classification, projectId, limit);
      break;
    }
    case "vector_search":
    default: {
      const searchQuery = classification.entities.searchQuery ?? query;
      results = await vectorSearchHandler(searchQuery, projectId, limit);
      break;
    }
  }

  const durationMs = Date.now() - start;

  logger.info(
    { strategy: classification.strategy, resultCount: results.length, durationMs },
    "[intent-router] query complete"
  );

  return {
    routingStrategy: classification.strategy,
    entities: classification.entities,
    results,
    metadata: {
      classificationConfidence: classification.confidence,
      reasoning: classification.reasoning,
      durationMs,
    },
  };
}
