/** Progress/result messages for the `analyze` workflow. */
export const ANALYZE_MESSAGES = {
  ANALYZING: "Analyzing project...",
  /** No-arg auto mode (PLAT-007 Tier A) — printed before the fast-path/full/delta branch is known. */
  AUTO_ANALYZING: "Checking knowledge graph freshness...",
  AUTO_FULL_INGESTION:
    "No existing knowledge graph found — running full ingestion...",
  AUTO_DELTA_INGESTION: "Re-parsing changed files since the last analysis...",
  AUTO_NOOP: "Knowledge graph already up to date with HEAD.",
  EXTRACTING: (targetPath: string) =>
    `Extracting decisions from ${targetPath}...`,
  FILES_DROPPED: (count: number) =>
    `Dropped ${count} file(s) from decision extraction (file-count/byte cap)`,
  /**
   * phase1-decision-integration.md §3b, case 3: no L2 node could be resolved for this
   * extraction run (empty or not-yet-ingested graph, or a project row that doesn't exist yet).
   * Decisions are still returned to the caller/CLI, just never persisted — never invent a
   * synthetic L2 anchor node.
   */
  NO_GRAPH_TO_ATTACH:
    "run `docuvia init` first — decisions need a graph to attach to",
  PATH_NOT_FOUND: (targetPath: string) => `Path does not exist: ${targetPath}`,
  LLM_NON_JSON_OUTPUT: "LLM returned non-JSON output for decision extraction",
  FILE_READ_FAILED: "Failed to read file for decision extraction",

  /** `analyze --escalate-to-lsp` (Tier B batch, phase1-decision-integration.md §8). */
  TIER_B_STARTING: "Running the Tier B LSP escalation batch...",
  TIER_B_EMPTY_QUEUE: "Tier B queue is empty -- nothing to escalate.",
  TIER_B_DEGRADED: (reason: string) =>
    `LSP unavailable -- AST-level edges left untouched (${reason})`,
  TIER_B_SUMMARY: (processed: number, edges: number) =>
    `Tier B batch complete: ${processed} file(s) processed, ${edges} corrected edge(s) applied`,
} as const;

/** Structured-log event names appended to `analyze.log` by the `analyze` workflow. The old
 *  config-scan-only `analyze.start`/`analyze.summary` events died with the no-arg auto-mode
 *  breaking change (PLAT-007 Tier A; phase1-decision-integration.md §6a). */
export const ANALYZE_EVENTS = {
  AUTO_START: "analyze.auto.start",
  /** Run-level failure line covering the whole auto-mode dispatch (phase1-decision-integration.md §6c). */
  AUTO_ERROR: "analyze.auto.error",
  DELTA_NOOP: "analyze.delta.noop",
  DELTA_NO_HEAD: "analyze.delta.no_head",
  FOCUSED_START: "analyze.focused.start",
  FOCUSED_ERROR: "analyze.focused.error",
  FOCUSED_SUMMARY: "analyze.focused.summary",
  FOCUSED_PERSISTED: "analyze.focused.persisted",
  FOCUSED_PERSIST_SKIPPED: "analyze.focused.persist_skipped",

  TIER_B_START: "analyze.tierB.start",
  TIER_B_EMPTY_QUEUE: "analyze.tierB.empty_queue",
  TIER_B_FILE_DROPPED_DELETED: "analyze.tierB.file_dropped_deleted",
  TIER_B_FILE_SKIPPED_LANGUAGE: "analyze.tierB.file_skipped_language",
  TIER_B_DEGRADED: "analyze.tierB.degraded",
  TIER_B_FILE_FAILED: "analyze.tierB.file_failed",
  TIER_B_SUMMARY: "analyze.tierB.summary",
  TIER_B_ERROR: "analyze.tierB.error",
} as const;

/**
 * System prompt for the focused decision-extraction LLM call — verbatim port of old Docuvia's
 * `DEFAULT_PROMPTS.path_decision_extractor` (`d:\GitHub\Docuvia\lib\core\src\utils\prompts.ts`).
 */
export const DECISION_EXTRACTION_SYSTEM_PROMPT = `You are an expert software architect reviewing source code directly (not commit history).
Extract concrete implementation decisions, architectural rules, notable constraints, and rationale that are evident from the code itself — not speculative commentary.
Return ONLY a valid JSON array. Each item:
{ "title": "concise title", "nodeType": "change" | "rule" | "decision" | "context", "content": "detailed explanation grounded in what the code actually does", "confidence": 0.0 to 1.0 }
If the code contains no decision-worthy content, return an empty array — do not fabricate entries.
OUTPUT MUST BE VALID JSON ONLY. NO MARKDOWN WRAPPERS. DO NOT OUTPUT \`\`\`json.`;
