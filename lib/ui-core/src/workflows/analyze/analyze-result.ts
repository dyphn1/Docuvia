export interface ExtractedDecision {
  title: string;
  nodeType: "change" | "rule" | "decision" | "context";
  content: string;
  confidence: number;
}

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
      kind: "autoFullIngestion";
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
      kind: "autoDelta";
      fromSha: string;
      headSha: string;
      filesReparsed: number;
      filesDeleted: number;
      filesFailed: number;
      filesSkippedOversized: number;
      /** Count of distinct files newly enqueued (or re-enqueued with a newer commitSha) into the
       *  `tierBQueue` docuvia_meta key this run — not the queue's total size. */
      tierBQueued: number;
    }
  | {
      /** `HEAD` already equals the last-ingested source sha — the idempotency fast-path (§6a),
       *  the first check auto mode makes. `headSha` is `null` on an unborn/headless HEAD (no
       *  commits yet) with an already-populated graph — nothing to diff against, so this is
       *  treated as a harmless no-op rather than an error. */
      kind: "autoDeltaNoop";
      headSha: string | null;
    };

export type AnalyzeResult =
  | AutoModeResult
  | {
      kind: "decisionExtraction";
      targetPath: string;
      decisions: ExtractedDecision[];
      /** Count of `decisions` newly written to `l3_nodes` (a fresh content_hash). */
      persisted: number;
      /** Count of `decisions` that matched an existing `l3_nodes` row by content_hash and were
       *  merged into it (occurrence bump) rather than inserted as a duplicate. */
      deduped: number;
    };
