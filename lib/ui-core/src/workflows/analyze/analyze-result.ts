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
  /** `analyze --flush-staged-l3` (issue #42, Decision 2's two-stage stage-and-flush design §8.2)
   *  -- the post-commit hook's drain of `.docuvia/pending-l3-decisions.json` entries whose
   *  `filePath` is in the triggering commit's changed-file list. A fourth, mutually-exclusive
   *  mode alongside auto/`targetPath`/`--escalate-to-lsp` -- no `targetPath`, no `--escalate-to-lsp`. */
  FLUSH_STAGED_L3: "flushStagedL3",
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
  /** Entries whose LSP resolution failed individually but are *retryable* (whole-batch timeout
   *  cut their turn short, or they were never reached before the deadline) -- kept in the queue
   *  for the next batch (§8g). Always 0 when `degraded` is true (nothing was attempted at all in
   *  that case). */
  filesFailed: number;
  /** Entries whose LSP resolution failed *permanently* (`retryable: false`, e.g. "no package
   *  metadata" -- a file the language server definitively cannot load) -- stamped as Tier-B-tried
   *  and *dropped from the re-queued `failedEntries`*, since re-running them next batch can only
   *  repeat the same empty retry (2026-08 moby benchmark finding: an uncapped full-repo run
   *  re-processed hundreds of permanently-unloadable files on every batch, ~0 edges). */
  filesFailedPermanent: number;
  /** `true` when the zero-progress watchdog fired this batch (issue #22 split 2): the batch was
   *  the Nth consecutive one that drained an attemptable set with zero progress (0 files
   *  processed AND 0 edges applied), so the still-retryable remainder (`failedEntries`) was
   *  escalated to permanently-failed and dropped from the re-queue rather than being re-attempted
   *  again. Only set (and only `true`) on the batch that actually trips it; absent on every other
   *  batch. */
  zeroProgressWatchdogTripped?: boolean;
  /** Cross-file `calls` edges newly written to `node_links` this batch (§8d). */
  edgesApplied: number;
  /** Dangling `node_links` rows removed by the incoming-edge repair hygiene pass (§8d). */
  edgesPruned: number;
  /** `true` when the provider could not run at all (binary unresolvable, spawn/timeout) --
   *  AST-level edges were left untouched, per §8b's honest-degradation rule. Since issue #33 this
   *  is scoped to the run as a whole: a *stray* secondary-language degradation (some other
   *  language bucket ran fine) leaves it `false` and surfaces via `strayLanguageDegraded` +
   *  `degradedLanguages` instead, so a primary-language-healthy run isn't reported degraded over
   *  one unrelated file. */
  degraded: boolean;
  degradedReason?: string;
  /** Per-language fidelity behind `degraded`/`degradedReason` above (multi-language-lsp-support
   *  plan, Finding F) -- additive, only set when at least one queued language's provider could not
   *  run at all this batch. Consumed by JSONL logging and `doctor`'s per-language diagnostic.
   *  Present even when `degraded` is `false` (issue #33): a stray secondary-bucket degradation
   *  keeps the run healthy in aggregate but is still recorded here. */
  degradedLanguages?: { languageId: string; reason: string }[];
  /** Issue #33: `true` when at least one language bucket degraded while another language bucket in
   *  the same batch ran fine (e.g. ripgrep's single bundled `.rb` Homebrew formula degrading the
   *  ruby bucket while the 100-file rust bucket processed normally). The run is reported
   *  `degraded: false` in that shape -- the degradation is confined to an unrelated stray bucket. */
  strayLanguageDegraded?: boolean;
  /** Issue #33: `true` when every language bucket that had queued files degraded this batch -- the
   *  genuinely-stuck whole-batch environment-outage shape, and the only degradation that exempts a
   *  batch from the zero-progress watchdog streak. */
  fullyDegraded?: boolean;
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
  | TierBBatchResult
  | {
      kind: typeof AnalyzeResultKind.FLUSH_STAGED_L3;
      /** `true` when this run no-op'd because `commit-l3-write` is disabled (Part E's toggle) --
       *  `flushed`/`deduped`/`stillPending` are all `0`/unchanged in that case; nothing was read
       *  or written. */
      skippedDisabled: boolean;
      /** Count of staged decisions newly written to `l3_nodes` this run (a fresh content_hash). */
      flushed: number;
      /** Of the flushed decisions, how many matched an existing row by content_hash (occurrence
       *  bump) rather than inserting a new one. */
      deduped: number;
      /** Count of staged decisions left untouched in the staging file -- their `filePath` wasn't
       *  in this commit's changed-file list (staged mid-session, committed later or never). */
      stillPending: number;
      /** The commit sha this flush ran against (`HEAD` at the moment the post-commit hook fired),
       *  or `null` on the (essentially unreachable, post-commit-only) unborn/headless-HEAD case. */
      commitSha: string | null;
    };
