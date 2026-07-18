import { DecisionNodeType, type ExtractedDecision } from "./analyze-result.js";

const VALID_NODE_TYPES = Object.values(DecisionNodeType);
const MARKDOWN_CODE_FENCE = "```";

/**
 * Strips a wrapping markdown code fence (```` ```json\n...\n``` ```` or bare ```` ```\n...\n``` ````)
 * from `raw`, tolerating leading/trailing whitespace around the fence. Many OpenAI-compatible LLM
 * backends (e.g. Mistral) wrap valid JSON responses in a markdown fence even when not asked to,
 * which breaks a direct `JSON.parse()`. If `raw` isn't fenced, it is returned unchanged.
 */
export function stripMarkdownCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (
    !trimmed.startsWith(MARKDOWN_CODE_FENCE) ||
    !trimmed.endsWith(MARKDOWN_CODE_FENCE)
  ) {
    return raw;
  }

  const newlineIndex = trimmed.indexOf("\n");
  if (newlineIndex === -1) {
    // A single line of nothing but backticks (and maybe a language tag) — no body to extract.
    return raw;
  }

  const firstLine = trimmed.slice(0, newlineIndex);
  if (!/^```[A-Za-z0-9_-]*$/.test(firstLine)) {
    // Opening "fence" line contains more than just ``` + an optional language tag — not a
    // fence we recognize; leave the content untouched rather than risk mangling it.
    return raw;
  }

  const withoutOpening = trimmed.slice(newlineIndex + 1);
  const withoutClosing = withoutOpening.slice(0, withoutOpening.length - 3);
  return withoutClosing.trim();
}

/**
 * Parses an LLM chat-completion's raw text content into `ExtractedDecision[]`, tolerating a
 * markdown-fenced JSON array (`stripMarkdownCodeFence`) and coercing missing/invalid `nodeType`
 * values to `DecisionNodeType.CONTEXT` — the same parsing contract
 * `AnalyzeWorkflow.executeDecisionExtraction` uses for `analyze <targetPath>`, factored out so
 * Tier C's commit-message/`CONTRACT_CHANGED`-symbol extraction calls
 * (`run-tier-c-drain.ts`) share it rather than re-deriving it. Returns `undefined` when `raw` is
 * `null`/`undefined` or isn't a JSON array after stripping the fence -- the caller decides how to
 * log/report that as a failure (mirrors the existing focused-extraction error handling).
 */
export function parseDecisionsFromLlmContent(
  raw: string | null | undefined,
): ExtractedDecision[] | undefined {
  if (raw === null || raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownCodeFence(raw));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;

  return parsed.map((item: any) => ({
    title: String(item?.title ?? ""),
    nodeType: (VALID_NODE_TYPES as readonly string[]).includes(item?.nodeType)
      ? (item.nodeType as ExtractedDecision["nodeType"])
      : DecisionNodeType.CONTEXT,
    content: String(item?.content ?? ""),
    confidence: typeof item?.confidence === "number" ? item.confidence : 0,
  }));
}
