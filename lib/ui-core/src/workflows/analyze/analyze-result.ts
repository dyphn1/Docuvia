/** `ExtractedDecision.nodeType` values — mirrors GitNexus's L3 node-type vocabulary. */
export const DecisionNodeType = {
  CHANGE: "change",
  RULE: "rule",
  DECISION: "decision",
  CONTEXT: "context",
} as const;
export type DecisionNodeType =
  (typeof DecisionNodeType)[keyof typeof DecisionNodeType];

export interface ExtractedDecision {
  title: string;
  nodeType: DecisionNodeType;
  content: string;
  confidence: number;
}

/** `AnalyzeResult.kind` discriminant values. The old `configScan` kind died with the no-arg
 *  auto-mode breaking change (PLAT-007 Tier A; phase1-decision-integration.md §6a). */
export const AnalyzeResultKind = {
  AUTO_FULL_INGESTION: "autoFullIngestion",
  AUTO_DELTA: "autoDelta",
  AUTO_DELTA_NOOP: "autoDeltaNoop",
  DECISION_EXTRACTION: "decisionExtraction",
  /** `analyze --escalate-to-lsp` — the Tier B batch (PLAT-007; phase1-decision-integration.md
   *  §8). A sibling mode to auto mode / focused extraction, not a modifier of either — it
   *  consumes the `tierBQueue` accumulated by prior Tier A (no-flag) runs, never re-runs Tier A
   *  itself. */
  TIER_B_BATCH: "tierBBatch",
} as const;

/**
 * No-arg `docuvia analyze` result shapes (PLAT-007 Tier A; phase1-decision-integration.md §6).
 * Replaces the old, single `{kind: "configScan", ...}` shape — a deliberate breaking change
 * (accepted in PLAT-007): no-arg `analyze` is now auto mode, dispatching on the graph's state
 * rather than always doing a config-scan-only pass.
 */
export type AutoModeResult =
  | {
      /** Graph had no project row or no L2 nodes — ran the same discovery -> config-scan ->
       *  AST-parse -> persist pipeline `init` Phase 3-4 uses. The old config-scan-only output
       *  (`projectType`/`suggestedTags`) is reported as part of this, per §6a. */
      kind: typeof AnalyzeResultKind.AUTO_FULL_INGESTION;
      projectType: string;
      suggestedTags: string[];
      filesRequested: number;
      filesParsed: number;
      filesFailed: number;
      filesSkippedOversized: number;
    }
  | {
      /** Non-empty graph, `HEAD` had moved since the last ingestion — re-parsed added/modified
       *  source files (filtered by the same discovery rules), dropped deleted files' L2 rows, and
       *  enqueued any `CONTRACT_CHANGED` files into the Tier B queue (§6b). */
      kind: typeof AnalyzeResultKind.AUTO_DELTA;
      fromSha: string;
      headSha: string;
      filesReparsed: number;
      filesDeleted: number;
      filesFailed: number;
      filesSkippedOversized: number;
      /** Count of distinct files newly enqueued (or re-enqueued with a newer commitSha) into the
       *  `tierBQueue` docuvia_meta key this run — not the queue's total size. */
      tierBQueued: number;
      /** Count of Tier C candidates (commit messages + `CONTRACT_CHANGED` symbols) newly
       *  enqueued into the `tierCQueue` docuvia_meta key this run (phase1-decision-integration.md
       *  §9b/§9e) — not the queue's total size. */
      tierCQueued: number;
    }
  | {
      /** `HEAD` already equals the last-ingested source sha — the idempotency fast-path (§6a),
       *  the first check auto mode makes. `headSha` is `null` on an unborn/headless HEAD (no
       *  commits yet) with an already-populated graph — nothing to diff against, so this is
       *  treated as a harmless no-op rather than an error. */
      kind: typeof AnalyzeResultKind.AUTO_DELTA_NOOP;
      headSha: string | null;
      /** `true` when the working tree has uncommitted changes at the moment the sha fast-path
       *  short-circuited (2026-07-24 C# benchmark finding: the fast-path is HEAD-sha-based, so an
       *  uncommitted edit is invisible to it — this flag is what lets the CLI/log tell an
       *  interactively-running human their dirty tree was silently skipped, instead of leaving
       *  them thinking `analyze` inspected their pending edits). Always `false` on the
       *  unborn/headless-HEAD branch (`headSha: null`) — that path returns before a working-tree
       *  check would be meaningful. */
      dirtyWorktree: boolean;
    };

/** `analyze --escalate-to-lsp`'s result shape (§8, D1-D6). */
export interface TierBBatchResult {
  kind: typeof AnalyzeResultKind.TIER_B_BATCH;
  headSha: string | null;
  /** Total entries read from `tierBQueue` at the start of this batch. */
  filesQueued: number;
  /** Entries dropped because the file no longer exists at HEAD (§8g). */
  filesDroppedDeleted: number;
  /** Entries skipped because their language has no Tier B plugin yet (§8e). */
  filesSkippedLanguage: number;
  /** Entries the LSP provider successfully resolved edges for (or attempted with zero edges
   *  found -- still a success). */
  filesProcessed: number;
  /** Entries whose LSP resolution failed individually -- kept in the queue for the next batch
   *  (§8g). Always 0 when `degraded` is true (nothing was attempted at all in that case). */
  filesFailed: number;
  /** Cross-file `calls` edges newly written to `node_links` this batch (§8d). */
  edgesApplied: number;
  /** Dangling `node_links` rows removed by the incoming-edge repair hygiene pass (§8d). */
  edgesPruned: number;
  /** `true` when the provider could not run at all (binary unresolvable, spawn/timeout) --
   *  AST-level edges were left untouched, per §8b's honest-degradation rule. */
  degraded: boolean;
  degradedReason?: string;
  /** Per-language fidelity behind `degraded`/`degradedReason` above (multi-language-lsp-support
   *  plan, Finding F) -- additive, only set when at least one queued language's provider could not
   *  run at all this batch. Consumed by JSONL logging and `doctor`'s per-language diagnostic. */
  degradedLanguages?: { languageId: string; reason: string }[];
  /** `true` when `rev-list --count lastTierBBatchSha..HEAD >= cap` at batch time (§8f) --
   *  observability only in this slice; does not gate anything (see the implementer's report on
   *  the commit-hook-cannot-start-LSP tension). */
  commitCapExceeded: boolean;

  // --- Tier C drain summary (phase1-decision-integration.md §9, folded into the same
  // `--escalate-to-lsp` composition per §9d's "no new command" ruling) ---

  /** `tierCQueue` size at the start of this run's drain attempt. */
  tierCQueued: number;
  /** Tier C candidates whose extraction succeeded and were persisted (fresh row or dedup bump). */
  tierCProcessed: number;
  /** Of `tierCProcessed`, how many landed as a brand-new `l3_nodes` row (vs. a content-hash dedup bump). */
  tierCPersisted: number;
  tierCDeduped: number;
  /** Candidates attempted but not successfully persisted this run (LLM/parse failure, or no
   *  anchor resolvable) -- left in the queue for a future run. */
  tierCFailed: number;
  /** `true` when the whole drain was skipped this run (lock contended, budget exhausted, system
   *  load high, or the LLM bridge isn't configured/reachable) -- honest degradation, §9d/§9f. */
  tierCSkipped: boolean;
  tierCSkippedReason?: string;
}

export type AnalyzeResult =
  | AutoModeResult
  | {
      kind: typeof AnalyzeResultKind.DECISION_EXTRACTION;
      targetPath: string;
      decisions: ExtractedDecision[];
      /** Count of `decisions` newly written to `l3_nodes` (a fresh content_hash). */
      persisted: number;
      /** Count of `decisions` that matched an existing `l3_nodes` row by content_hash and were
       *  merged into it (occurrence bump) rather than inserted as a duplicate. */
      deduped: number;
    }
  | TierBBatchResult;
