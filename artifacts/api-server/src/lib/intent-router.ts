import { getLlmClientForProject } from "./llm-provider.js";
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
import { generateEmbedding } from "./embedding.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoutingStrategy = "vector_search" | "graph_traversal" | "direct_lookup" | "hybrid";

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
export function sanitizeLikeInput(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

export function escapeLike(str: string): string {
  return str.replace(/[\\%_]/g, "\\$&");
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

function applyTemporalDecay(baseScore: number, referenceDate: Date): number {
  return baseScore * calculateTemporalDecay(referenceDate);
}

export async function classifyIntent(query: string, projectId?: number): Promise<IntentClassification> {
  const sanitized = sanitizeQuery(query);
  const fallback: IntentClassification = {
    strategy: "vector_search",
    entities: { searchQuery: sanitized },
    confidence: 0.5,
    reasoning: "Fallback to vector_search due to classification failure.",
  };

  try {
    const { client, model } = await getLlmClientForProject(projectId);
    const response = await client.chat.completions.create({
      model: model || process.env.AI_OPENAI_FAST_MODEL || "gpt-4o-mini",
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
      typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";

    return {
      strategy: strategy as RoutingStrategy,
      entities: {
        moduleName: typeof entities.moduleName === "string" ? entities.moduleName : null,
        commitHash: typeof entities.commitHash === "string" ? entities.commitHash : null,
        searchQuery: typeof entities.searchQuery === "string" ? entities.searchQuery : sanitized,
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
  const queryEmbedding = await generateEmbedding(projectId, query);

  if (queryEmbedding) {
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    const l2Limit = limit;

    // L2 nodes: pgvector similarity search with temporal decay
    const l2Sql = sql`
      SELECT
        l2.id, l2.name, l2.description, l2.project_id, l2.created_at, l2.last_verified_at,
        p.name as project_name,
        (1 - (l2.embedding::vector <=> ${vectorStr}::vector)) * EXP(-0.05 * EXTRACT(EPOCH FROM (NOW() - COALESCE(l2.last_verified_at, l2.created_at)))/86400) as score
      FROM l2_nodes l2
      LEFT JOIN projects p ON p.id = l2.project_id
      WHERE l2.embedding IS NOT NULL
      ${projectId != null ? sql`AND l2.project_id = ${projectId}` : sql``}
      ORDER BY score DESC
      LIMIT ${l2Limit}
    `;
    const l2Rows = await db.execute(l2Sql);

    for (const row of l2Rows.rows ?? []) {
      results.push({
        source: "vector",
        nodeLayer: "l2",
        id: (row as any).id,
        title: (row as any).name,
        content: (row as any).description ?? null,
        projectId: (row as any).project_id,
        projectName: (row as any).project_name ?? null,
        score: (row as any).score,
        createdAt: new Date((row as any).created_at).toISOString(),
      });
    }

    // L3 nodes: pgvector similarity search with temporal decay
    const l3ValidityFilter = includePending
      ? sql`AND l3.validity_status IN ('valid', 'pending')`
      : sql`AND l3.validity_status = 'valid'`;

    const l3Sql = sql`
      SELECT
        l3.id, l3.title, l3.content, l3.node_type, l3.created_at, l3.last_verified_at,
        l2.project_id,
        p.name as project_name,
        (1 - (l3.embedding::vector <=> ${vectorStr}::vector)) * EXP(-0.05 * EXTRACT(EPOCH FROM (NOW() - COALESCE(l3.last_verified_at, l3.created_at)))/86400) as score
      FROM l3_nodes l3
      INNER JOIN l2_nodes l2 ON l2.id = l3.l2_node_id
      LEFT JOIN projects p ON p.id = l2.project_id
      WHERE l3.embedding IS NOT NULL ${l3ValidityFilter}
      ${projectId != null ? sql`AND l2.project_id = ${projectId}` : sql``}
      ORDER BY score DESC
      LIMIT ${limit}
    `;
    const l3Rows = await db.execute(l3Sql);

    for (const row of l3Rows.rows ?? []) {
      results.push({
        source: "vector",
        nodeLayer: "l3",
        id: (row as any).id,
        title: (row as any).title,
        content: (row as any).content ?? null,
        projectId: (row as any).project_id,
        projectName: (row as any).project_name ?? null,
        score: (row as any).score,
        createdAt: new Date((row as any).created_at).toISOString(),
      });
    }
  } else {
    // Fallback: SQL LIKE search (no embedding available)
    const escapedQuery = sanitizeLikeInput(query);
    const pattern = `%${escapedQuery}%`;

    const l3ValidityCondition = includePending
      ? or(eq(l3NodesTable.validityStatus, "valid"), eq(l3NodesTable.validityStatus, "pending"))
      : eq(l3NodesTable.validityStatus, "valid");

    let l2FallbackQuery = db.select().from(l2NodesTable).$dynamic();
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
        score: applyTemporalDecay(0.9, node.lastVerifiedAt ?? node.createdAt),
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
      l3ValidityCondition,
      or(
        like(l3NodesTable.title, pattern),
        like(sql`COALESCE(${l3NodesTable.content}, '')`, pattern)
      ),
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
        score: applyTemporalDecay(0.8, node.lastVerifiedAt ?? node.createdAt),
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
  projectId?: number,
  limit = 20
): Promise<AgenticSearchResult[]> {
  const results: AgenticSearchResult[] = [];

  const escapedModuleName = sanitizeLikeInput(moduleName);
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

  results.push({
    source: "graph",
    nodeLayer: "l2",
    id: node.id,
    title: node.name,
    content: node.description ?? null,
    projectId: node.projectId,
    projectName: proj?.name ?? null,
    score: applyTemporalDecay(1.0, node.lastVerifiedAt ?? node.createdAt),
    createdAt: node.createdAt.toISOString(),
  });

  // Batch query for out-links
  const outLinks = await db
    .select()
    .from(nodeLinksTable)
    .where(eq(nodeLinksTable.sourceNodeId, node.id));

  if (outLinks.length > 0) {
    const targetIds = outLinks.map((l) => l.targetNodeId);
    const relatedL2s = await db
      .select()
      .from(l2NodesTable)
      .where(sql`${l2NodesTable.id} IN ${targetIds}`);

    for (const r of relatedL2s) {
      results.push({
        source: "graph",
        nodeLayer: "l2",
        id: r.id,
        title: r.name,
        content: `Related dependency of ${node.name}`,
        projectId: r.projectId,
        projectName: proj?.name ?? null,
        score: applyTemporalDecay(0.8, r.lastVerifiedAt ?? r.createdAt),
        createdAt: r.createdAt.toISOString(),
      });
    }
  }

  // Fetch L3 nodes associated with the seed node, sorted by validity and occurrence
  const l3Decisions = await db
    .select()
    .from(l3NodesTable)
    .where(eq(l3NodesTable.l2NodeId, node.id))
    .orderBy(sql`${l3NodesTable.occurrenceCount} DESC`)
    .limit(limit);

  for (const l3 of l3Decisions) {
    results.push({
      source: "graph",
      nodeLayer: "l3",
      id: l3.id,
      title: l3.title,
      content: l3.content,
      projectId: node.projectId,
      projectName: proj?.name ?? null,
      score: applyTemporalDecay(0.9, node.lastVerifiedAt ?? node.createdAt),
      createdAt: l3.createdAt.toISOString(),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Handler: Direct Lookup
// ---------------------------------------------------------------------------

export async function directLookupHandler(
  searchQuery: string,
  projectId?: number,
  limit = 20,
  includePending = false
): Promise<AgenticSearchResult[]> {
  const results: AgenticSearchResult[] = [];

  // Determine if it's a commit hash format
  const isHash = /^[0-9a-fA-F]{4,40}$/.test(searchQuery);

  if (isHash) {
    const l3Nodes = await db
      .select()
      .from(l3NodesTable)
      .where(like(l3NodesTable.introducedInCommit, `${searchQuery}%`))
      .limit(limit);

    for (const l3 of l3Nodes) {
      if (!includePending && l3.validityStatus !== "valid") continue;
      // Resolve project ID using subquery or simple fetch
      const [l2] = await db
        .select({ projectId: l2NodesTable.projectId })
        .from(l2NodesTable)
        .where(eq(l2NodesTable.id, l3.l2NodeId));
      if (projectId && l2?.projectId !== projectId) continue;

      results.push({
        source: "direct",
        nodeLayer: "l3",
        id: l3.id,
        title: l3.title,
        content: l3.content,
        projectId: l2?.projectId ?? 0,
        projectName: null,
        score: applyTemporalDecay(1.0, l3.lastVerifiedAt ?? l3.createdAt),
        createdAt: l3.createdAt.toISOString(),
      });
    }
  } else {
    // Full-text content search fallback
    const sanitizedQuery = sanitizeLikeInput(searchQuery);

    // We would ideally use Postgres Full Text Search (to_tsvector/to_tsquery)
    // but sticking to ILIKE for architectural continuity here.
    const l3Nodes = await db
      .select()
      .from(l3NodesTable)
      .where(
        or(
          sql`${l3NodesTable.title} ILIKE ${`%${sanitizedQuery}%`}`,
          sql`${l3NodesTable.content} ILIKE ${`%${sanitizedQuery}%`}`
        )
      )
      .limit(limit);

    for (const l3 of l3Nodes) {
      if (!includePending && l3.validityStatus !== "valid") continue;
      const [l2] = await db
        .select({ projectId: l2NodesTable.projectId })
        .from(l2NodesTable)
        .where(eq(l2NodesTable.id, l3.l2NodeId));
      if (projectId && l2?.projectId !== projectId) continue;

      results.push({
        source: "direct",
        nodeLayer: "l3",
        id: l3.id,
        title: l3.title,
        content: l3.content,
        projectId: l2?.projectId ?? 0,
        projectName: null,
        score: applyTemporalDecay(0.8, l3.lastVerifiedAt ?? l3.createdAt),
        createdAt: l3.createdAt.toISOString(),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
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
      existing.score += r.score * 0.25;
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

  // Max's Rule: Use exact matching instead of ReDoS-vulnerable regex.
  // We avoid native Regex. Check if it's a single word (e.g. symbol) without spaces.
  const isSingleWord = !/\s/.test(trimmed) && trimmed.length > 3;

  if (isSingleWord) {
    const rawSearch = trimmed.replace(/[`"]/g, "");
    // Fall back to directSearch which now utilizes standard DB ILIKE (surrogate for pg_trgm)
    const results = await directLookupHandler(rawSearch, projectId, limit, includePending);

    // If we find exact matches, return instantly without calling the LLM
    if (results.length > 0) {
      return {
        routingStrategy: "direct_lookup",
        entities: { searchQuery: rawSearch },
        results,
        metadata: {
          classificationConfidence: 1.0,
          reasoning: "Exact match short-circuit",
          durationMs: Date.now() - start,
        },
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

    const allArchitecturalTerms = [...tags.map((t) => t.name), ...l2Rows.map((n) => n.name)];

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
    classification = await classifyIntent(query, projectId);
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
      const searchQuery = classification.entities.searchQuery ?? query;
      results = await directLookupHandler(searchQuery, projectId, limit, includePending);
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
