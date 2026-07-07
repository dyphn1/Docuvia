import { IIntentClassifier } from "../../interfaces/intent-router.interfaces.js";
import { IntentClassification, RoutingStrategy } from "../../types/intent-router.types.js";
import { getLlmOrchestratorForProject } from "../llm-provider.js";
import { logger } from "../../utils/logger.js";
import { sanitizeQuery } from "./router.utils.js";

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

export class IntentClassifierService implements IIntentClassifier {
  async classifyIntent(query: string, projectId?: number): Promise<IntentClassification> {
    const sanitized = sanitizeQuery(query);
    const fallback: IntentClassification = {
      strategy: "vector_search",
      entities: { searchQuery: sanitized },
      confidence: 0.5,
      reasoning: "Fallback to vector_search due to classification failure.",
    };

    try {
      const { orchestrator, model } = await getLlmOrchestratorForProject(projectId);
      const response = await orchestrator.generate({
        model: model || process.env.AI_OPENAI_FAST_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
          { role: "user", content: sanitized },
        ],
        max_tokens: 256,
      });

      const raw = response.content;
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
}
