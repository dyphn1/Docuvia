import { getLlmClientForProject } from "../llm-provider.js";
import { logger } from "../../utils/logger.js";
import { sanitizeQuery } from "./router.utils.js";
import { SqliteGraphRepository } from "../sqlite-graph.repository.js";
import { LocalQueryIntent, RouteQueryResult } from "../../types/intent-router.types.js";

/**
 * Local-mode Natural Language UI (ADR-029, graceful degradation per ADR-002).
 *
 * Instead of local vector search (deprecated — pgvector is server-only per
 * ADR-019), a lightweight LLM call parses natural language into a structured
 * query (hard keywords + node references), which is then resolved against
 * SQLite FTS5 and AST graph traversal.
 */

const EXTRACTION_SYSTEM_PROMPT = `You are an intent extractor for a local software knowledge graph.

Given a natural language query about a codebase, extract:
- keywords: hard search keywords (identifiers, file names, domain terms). Omit filler words.
- nodeRefs: names of specific code symbols, modules, classes, or functions the user explicitly references.

Return ONLY valid JSON with this exact shape:
{
  "keywords": ["<string>", ...],
  "nodeRefs": ["<string>", ...]
}`;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "of",
  "on",
  "or",
  "show",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

/**
 * Deterministic fallback when the LLM is unreachable: tokenize the query and
 * drop stop words so FTS5 still receives usable keywords.
 */
export function extractKeywordsHeuristically(query: string): string[] {
  const tokens = query
    .split(/[^\w./-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t.toLowerCase()));
  return Array.from(new Set(tokens));
}

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

export class LocalIntentExtractionService {
  constructor(
    private readonly llmClientFactory: typeof getLlmClientForProject = getLlmClientForProject
  ) {}

  async extractIntent(query: string, projectId?: number): Promise<LocalQueryIntent> {
    const sanitized = sanitizeQuery(query);
    const fallback: LocalQueryIntent = {
      keywords: extractKeywordsHeuristically(sanitized),
      nodeRefs: [],
    };

    try {
      const { client, model } = await this.llmClientFactory(projectId);
      const response = await client.chat.completions.create({
        model: model || process.env.AI_OPENAI_FAST_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: sanitized },
        ],
        max_tokens: 256,
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw) return fallback;

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const keywords = toStringArray(parsed.keywords);
      const nodeRefs = toStringArray(parsed.nodeRefs);

      if (keywords.length === 0 && nodeRefs.length === 0) return fallback;
      return { keywords, nodeRefs };
    } catch (err) {
      logger.warn(
        { err },
        "[local-nl-query] intent extraction failed, falling back to heuristic keywords"
      );
      return fallback;
    }
  }
}

/**
 * End-to-end local natural-language query: LLM intent extraction feeding
 * SQLite FTS5 + AST graph traversal. Always reports keyword_graph mode so the
 * UI can signal that it is NOT running semantic vector search.
 */
export async function runLocalNlQuery(
  workspaceRoot: string,
  query: string,
  options: { projectId?: number; limit?: number } = {}
): Promise<RouteQueryResult> {
  const start = Date.now();
  const limit = options.limit ?? 10;

  const extractor = new LocalIntentExtractionService();
  const intent = await extractor.extractIntent(query, options.projectId);

  const repository = new SqliteGraphRepository();
  const results = await repository.searchLocalNodes(workspaceRoot, intent, limit);

  return {
    routingStrategy: "direct_lookup",
    entities: { searchQuery: intent.keywords.join(" "), moduleName: intent.nodeRefs[0] ?? null },
    results,
    metadata: {
      classificationConfidence: 1.0,
      reasoning:
        "Local-first fallback: LLM intent extraction resolved via SQLite FTS5 and AST graph traversal (ADR-029).",
      durationMs: Date.now() - start,
      searchMode: "keyword_graph",
    },
  };
}
