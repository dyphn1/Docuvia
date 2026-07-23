/** Progress/result messages for the `analyze` workflow. */
export const ANALYZE_MESSAGES = {
  ANALYZING: "Analyzing project...",
  /** No-arg auto mode (PLAT-007 Tier A) — printed before the fast-path/full/delta branch is known. */
  AUTO_ANALYZING: "Checking knowledge graph freshness...",
  AUTO_FULL_INGESTION:
    "No existing knowledge graph found — running full ingestion...",
  AUTO_DELTA_INGESTION: "Re-parsing changed files since the last analysis...",
  AUTO_NOOP: "Knowledge graph already up to date with HEAD.",
  /** §10c's commit-time nudge — non-blocking, exit-0; `doctor` reports the same condition
   *  passively as a backup (T4) for anyone who doesn't read console output or grep logs. */
  TIER_B_CAP_NUDGE:
    "Changed code since the last Tier B batch has exceeded the cap -- push, or run `docuvia analyze --escalate-to-lsp && docuvia snapshot`, to trigger it.",
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

  /** Tier C's budgeted async LLM decision-extraction queue (phase1-decision-integration.md §9). */
  TIER_C_SKIPPED: (reason: string) =>
    `Tier C drain skipped this run (${reason})`,
  TIER_C_SUMMARY: (processed: number, persisted: number) =>
    `Tier C drain complete: ${processed} candidate(s) processed, ${persisted} decision(s) persisted`,
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
  /** §10c's commit-time nudge (Tier A half; `doctor`'s passive backup is a separate event). */
  TIER_B_COMMIT_CAP_NUDGE: "analyze.auto.tier_b_cap_nudge",

  /** `runFullIngestion`'s own start/summary lines (§6a). */
  FULL_START: "analyze.full.start",
  FULL_SUMMARY: "analyze.full.summary",
  /** Per-file lines from `runParseAndPersist` (shared with `init`) attributed to full ingestion. */
  FULL_PARSE_FAILURE: "analyze.full.parse_failure",
  FULL_FILE_SKIPPED_OVERSIZED: "analyze.full.file_skipped_oversized",
  /** `runDeltaIngestion`'s own start/summary lines (§6b). */
  DELTA_START: "analyze.delta.start",
  DELTA_SUMMARY: "analyze.delta.summary",
  DELTA_FILE_SKIPPED_OVERSIZED: "analyze.delta.file_skipped_oversized",
  /** Per-file line from `runParseAndPersist` attributed to delta ingestion. */
  DELTA_PARSE_FAILURE: "analyze.delta.parse_failure",
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

  /** Tier C's budgeted async LLM decision-extraction queue (phase1-decision-integration.md §9). */
  TIER_C_START: "analyze.tierC.start",
  TIER_C_EMPTY_QUEUE: "analyze.tierC.empty_queue",
  TIER_C_SKIPPED: "analyze.tierC.skipped",
  TIER_C_LOAD_NOTE: "analyze.tierC.load_note",
  TIER_C_ITEM_SUCCESS: "analyze.tierC.item_success",
  TIER_C_ITEM_FAILED: "analyze.tierC.item_failed",
  TIER_C_SUMMARY: "analyze.tierC.summary",
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

/**
 * Tier C's commit-message decision-extraction system prompt (phase1-decision-integration.md §9,
 * PLAT-007 Tier C candidate source (a)). Same JSON contract as
 * `DECISION_EXTRACTION_SYSTEM_PROMPT`, scoped down to a single (already filtered, §9e) commit
 * message rather than a file's full source — a judgment call not fully specified by §9's contract
 * (prompt shape was left open at contract time; flagged in the Slice 4 handover).
 */
export const TIER_C_COMMIT_MESSAGE_SYSTEM_PROMPT = `You are an expert software architect analyzing a single git commit message to extract at most one concrete implementation decision, architectural rule, or rationale evident from the message itself — not speculative commentary.
Return ONLY a valid JSON array (zero or one items). Each item:
{ "title": "concise title", "nodeType": "change" | "rule" | "decision" | "context", "content": "detailed explanation grounded in what the commit message actually says", "confidence": 0.0 to 1.0 }
If the commit message contains no decision-worthy content, return an empty array — do not fabricate entries.
OUTPUT MUST BE VALID JSON ONLY. NO MARKDOWN WRAPPERS. DO NOT OUTPUT \`\`\`json.`;

/**
 * Tier C's `CONTRACT_CHANGED`-symbol decision-extraction system prompt (phase1-decision-integration.md
 * §9, PLAT-007 Tier C candidate source (b)). Same JSON contract as
 * `DECISION_EXTRACTION_SYSTEM_PROMPT`, scoped to a single named symbol within its file.
 */
export const TIER_C_CONTRACT_SYMBOL_SYSTEM_PROMPT = `You are an expert software architect reviewing a single symbol whose public contract changed in a recent commit. Extract concrete implementation decisions, architectural rules, or rationale evident from the symbol's current source — not speculative commentary.
Return ONLY a valid JSON array. Each item:
{ "title": "concise title", "nodeType": "change" | "rule" | "decision" | "context", "content": "detailed explanation grounded in what the code actually does", "confidence": 0.0 to 1.0 }
If the code contains no decision-worthy content, return an empty array — do not fabricate entries.
OUTPUT MUST BE VALID JSON ONLY. NO MARKDOWN WRAPPERS. DO NOT OUTPUT \`\`\`json.`;

/** User-message wrapper for `TIER_C_CONTRACT_SYMBOL_SYSTEM_PROMPT` — scopes the LLM's attention
 *  to `symbolName` within `file`'s full source (`run-tier-c-drain.ts`'s
 *  `processContractSymbolEntry`). */
export const TIER_C_CONTRACT_SYMBOL_USER_MESSAGE = (
  symbolName: string,
  file: string,
  content: string,
) =>
  `Focus on the symbol \`${symbolName}\` in the following file (\`${file}\`):\n\n${content}`;
