import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import {
  projectsTable,
  l1TagsTable,
  l2NodesTable,
  l3NodesTable,
  nodeLinksTable,
  commitsTable,
} from "@workspace/db";
import { eq, like, isNotNull, or, and, sql, ilike } from "drizzle-orm";
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
 * Escapes SQL LIKE wildcards (% and _) to prevent injection.
 */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

/**
 * Sanitize user query before sending to LLM to prevent prompt injection.
 * Strips characters that could escape JSON or inject instructions.
 */
export function sanitizeQuery(query: string): string {
  return query
    .slice(0, 2000)
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim();
}

/**
 * Calculate the temporal decay factor for a node based on its last verified date.
 * Uses an exponential decay function with a 30-day half-life.
 */
export function calculateTemporalDecay(referenceDate: Date, now: number = Date.now()): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const HALF_LIFE_DAYS = 30;
  const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;
  const daysSinceVerified = (now - referenceDate.getTime()) / MS_PER_DAY;
  return Math.exp(-LAMBDA * Math.max(0, daysSinceVerified));
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
  limit = 10,
  includePending = false
): Promise<AgenticSearchResult[]> {
  const results: AgenticSearchResult[] = [];
  const queryEmbedding = await generateEmbedding(query);

  const l3ValidityCondition = includePending
    ? or(eq(l3NodesTable.validityStatus, "valid"), eq(l3NodesTable.validityStatus, "pending"))
    : eq(l3NodesTable.validityStatus, "valid");

  if (queryEmbedding) {
    // Semantic search: L2 nodes
    let l2Query = db
      .select()
      .from(l2NodesTable)
      .$dynamic();
    if (projectId) {
      l2Query = l2Query.where(and(isNotNull(l2NodesTable.embedding), eq(l2NodesTable.projectId, projectId)));
    } else {
      l2Query = l2Query.where(isNotNull(l2NodesTable.embedding));
    }
    const l2Rows = await l2Query;

    const l2Scored = l2Rows
      .map((node) => {
        const emb = parseEmbedding(node.embedding);
        const rawScore = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        const referenceDate = node.lastVerifiedAt ?? node.createdAt;
        const decayFactor = calculateTemporalDecay(referenceDate);
        const score = rawScore * decayFactor;
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
    let l3Query = db
      .select({
        node: l3NodesTable,
        projectId: l2NodesTable.projectId,
        projectName: projectsTable.name,
      })
      .from(l3NodesTable)
      .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
      .leftJoin(projectsTable, eq(l2NodesTable.projectId, projectsTable.id))
      .$dynamic();

    if (projectId) {
      l3Query = l3Query.where(
        and(isNotNull(l3NodesTable.embedding), l3ValidityCondition!, eq(l2NodesTable.projectId, projectId))
      );
    } else {
      l3Query = l3Query.where(
        and(isNotNull(l3NodesTable.embedding), l3ValidityCondition!)
      );
    }

    const l3Rows = await l3Query;

    const l3Scored = l3Rows
      .map(({ node, projectId, projectName }) => {
        const emb = parseEmbedding(node.embedding);
        const rawScore = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        const referenceDate = node.lastVerifiedAt ?? node.createdAt;
        const decayFactor = calculateTemporalDecay(referenceDate);
        const score = rawScore * decayFactor;
        return { node, projectId, projectName, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const { node, projectId, projectName, score } of l3Scored) {
      results.push({
        source: "vector",
        nodeLayer: "l3",
        id: node.id,
        title: node.title,
        content: node.content ?? null,
        projectId,
        projectName,
        score,
        createdAt: node.createdAt.toISOString(),
      });
    }
  } else {
    // Fallback: SQL LIKE search
    const escapedQuery = escapeLike(query);
    const pattern = `%${escapedQuery}%`;

    let l2FallbackQuery = db
      .select()
      .from(l2NodesTable)
      .$dynamic();
      
    if (projectId) {
      l2FallbackQuery = l2FallbackQuery.where(
        and(
          or(
            like(l2NodesTable.name, pattern),
            like(sql`COALESCE(${l2NodesTable.description}, '')`, pattern)
          ),
          eq(l2NodesTable.projectId, projectId)
        )
      );
    } else {
      l2FallbackQuery = l2FallbackQuery.where(
        or(
          like(l2NodesTable.name, pattern),
          like(sql`COALESCE(${l2NodesTable.description}, '')`, pattern)
        )
      );
    }
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

    let l3FallbackQuery = db
      .select({
        node: l3NodesTable,
        projectId: l2NodesTable.projectId,
        projectName: projectsTable.name,
      })
      .from(l3NodesTable)
      .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
      .leftJoin(projectsTable, eq(l2NodesTable.projectId, projectsTable.id))
      .$dynamic();

    const l3FallbackConditions = [
      l3ValidityCondition!,
      or(
        like(l3NodesTable.title, pattern),
        like(sql`COALESCE(${l3NodesTable.content}, '')`, pattern)
      )
    ];

    if (projectId) {
      l3FallbackConditions.push(eq(l2NodesTable.projectId, projectId));
    }

    l3FallbackQuery = l3FallbackQuery.where(and(...l3FallbackConditions)).limit(limit);

    const l3Rows = await l3FallbackQuery;

    for (const { node, projectId, projectName } of l3Rows) {
      results.push({
        source: "vector",
        nodeLayer: "l3",
        id: node.id,
        title: node.title,
        content: node.content ?? null,
        projectId,
        projectName,
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

  const escapedModuleName = escapeLike(moduleName);
  const nodes = await db
    .select()
    .from(l2NodesTable)
    .where(like(l2NodesTable.name, `%${escapedModuleName}%`));
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
  query: string,
  entities?: IntentClassification["entities"],
  includePending = false,
  projectId?: number
): Promise<AgenticSearchResult[]> {
  const results: AgenticSearchResult[] = [];

  const l3ValidityCondition = includePending
    ? or(eq(l3NodesTable.validityStatus, "valid"), eq(l3NodesTable.validityStatus, "pending"))
    : eq(l3NodesTable.validityStatus, "valid");

  const hexRegex = /^[0-9a-fA-F]{4,40}$/;
  const commitHash = entities?.commitHash;
  const isHex = hexRegex.test(query);
  const searchHash = commitHash || (isHex ? query : null);

  if (searchHash) {
    const escapedHash = escapeLike(searchHash);
    
    const commitConditions = [like(commitsTable.hash, `${escapedHash}%`)];
    if (projectId) commitConditions.push(eq(commitsTable.projectId, projectId));

    const [commit] = await db
      .select()
      .from(commitsTable)
      .where(and(...commitConditions));

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

    const l3Conditions = [
      like(l3NodesTable.commitHash, `${escapedHash}%`),
      l3ValidityCondition!
    ];
    if (projectId) l3Conditions.push(eq(l2NodesTable.projectId, projectId));

    const l3Nodes = await db
      .select({
        node: l3NodesTable,
        projectId: l2NodesTable.projectId,
        projectName: projectsTable.name,
      })
      .from(l3NodesTable)
      .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
      .leftJoin(projectsTable, eq(l2NodesTable.projectId, projectsTable.id))
      .where(and(...l3Conditions));

    for (const { node, projectId, projectName } of l3Nodes) {
      results.push({
        source: "direct",
        nodeLayer: "l3",
        id: node.id,
        title: node.title,
        content: node.content ?? null,
        projectId,
        projectName,
        score: 1.0,
        createdAt: node.createdAt.toISOString(),
      });
    }
  } else {
    const escapedQuery = escapeLike(query);
    const pattern = `%${escapedQuery}%`;

    const l3Conditions = [
      ilike(l3NodesTable.content, pattern),
      l3ValidityCondition!
    ];
    if (projectId) l3Conditions.push(eq(l2NodesTable.projectId, projectId));

    const l3Nodes = await db
      .select({
        node: l3NodesTable,
        projectId: l2NodesTable.projectId,
        projectName: projectsTable.name,
      })
      .from(l3NodesTable)
      .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
      .leftJoin(projectsTable, eq(l2NodesTable.projectId, projectsTable.id))
      .where(and(...l3Conditions));

    for (const { node, projectId, projectName } of l3Nodes) {
      results.push({
        source: "direct",
        nodeLayer: "l3",
        id: node.id,
        title: node.title,
        content: node.content ?? null,
        projectId,
        projectName,
        score: 1.0,
        createdAt: node.createdAt.toISOString(),
      });
    }
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
  limit = 10,
  includePending = false
): Promise<AgenticSearchResult[]> {
  const searchQuery = classification.entities.searchQuery ?? query;

  // Step 1: vector search
  const vectorResults = await vectorSearchHandler(searchQuery, projectId, limit, includePending);

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

  // Step 4: Merge and provide scoring boost for intersection
  const mergedMap = new Map<string, AgenticSearchResult>();

  for (const r of vectorResults) {
    const key = `${r.nodeLayer}:${r.id}`;
    mergedMap.set(key, { ...r });
  }

  for (const r of graphResults) {
    const key = `${r.nodeLayer}:${r.id}`;
    if (mergedMap.has(key)) {
      const existing = mergedMap.get(key)!;
      // Provide a scoring boost to elements present in both sets
      existing.score += r.score + 0.5;
    } else {
      mergedMap.set(key, { ...r });
    }
  }

  const merged = Array.from(mergedMap.values());

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
  limit = 10,
  includePending = false
): Promise<RouteQueryResult> {
  const start = Date.now();
  const trimmed = query.trim();

  // O(1) Fast-path: Regex pre-filter to bypass LLM latency
  // Matches PascalCase, camelCase, snake_case or explicitly wrapped in quotes/backticks
  const exactMatchRegex = /^([A-Z][a-zA-Z0-9]+|[a-z]+[A-Z][a-zA-Z0-9]+|[a-z]+_[a-z0-9_]+|`[^`]+`|"[^"]+")$/;
  
  if (exactMatchRegex.test(trimmed)) {
    const rawSearch = trimmed.replace(/[`"]/g, "");
    const results = await directSearch(rawSearch, projectId, limit, includePending);
    
    // If we find exact matches, return instantly without calling the LLM
    if (results.length > 0) {
      return {
        strategy: "direct",
        results,
        latencyMs: Date.now() - start
      };
    }
  }

  let classification: IntentClassification | null = null;

  // Fast Arbitration pipeline: Direct Filter
  if (query.includes("#attach") || /src\/|\.ts|\.md/i.test(query)) {
    classification = {
      strategy: "direct_lookup",
      entities: { searchQuery: query },
      confidence: 1.0,
      reasoning: "O(1) fast-path matched #attach or file extension",
    };
  }

  // Fast Arbitration pipeline: Graph Filter
  if (!classification) {
    const tags = await db.select({ name: l1TagsTable.name }).from(l1TagsTable);
    
    let l2Query = db.select({ name: l2NodesTable.name }).from(l2NodesTable).$dynamic();
    if (projectId) {
      l2Query = l2Query.where(eq(l2NodesTable.projectId, projectId));
    }
    const l2Rows = await l2Query;

    const allArchitecturalTerms = [...tags.map(t => t.name), ...l2Rows.map(n => n.name)];
    
    for (const term of allArchitecturalTerms) {
      if (term && query.toLowerCase().includes(term.toLowerCase())) {
        classification = {
          strategy: "graph_traversal",
          entities: { moduleName: term },
          confidence: 1.0,
          reasoning: "O(1) fast-path matched architectural term",
        };
        break;
      }
    }
  }

  // Fallback to LLM classification
  if (!classification) {
    classification = await classifyIntent(query);
  }

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
      results = await directLookupHandler(query, classification.entities, includePending, projectId);
      break;
    }
    case "hybrid": {
      results = await hybridSearch(query, classification, projectId, limit, includePending);
      break;
    }
    case "vector_search":
    default: {
      const searchQuery = classification.entities.searchQuery ?? query;
      results = await vectorSearchHandler(searchQuery, projectId, limit, includePending);
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
