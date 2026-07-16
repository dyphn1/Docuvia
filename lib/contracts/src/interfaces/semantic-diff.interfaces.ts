import type { DiffLineRange } from "./git.interfaces.js";

/**
 * Mirrors `lib/ast-core`'s `PruningLevel` enum as plain numeric literals so this contract stays
 * free of a `@workspace/ast-core` type dependency (Virtual Contracts — `lib/contracts` depends on
 * nothing else in the workspace). `0` = `INTERNAL_LOGIC` (blast radius 0), `1` =
 * `CONTRACT_CHANGED` (trigger diffusion — enqueues Tier B per PLAT-007).
 */
export type SemanticPruningLevel = 0 | 1;

export interface SemanticDiffModifiedNode {
  nodeId: string;
  nodeType: string;
  pruningLevel: SemanticPruningLevel;
  newRange: DiffLineRange;
}

/**
 * Classification-only wrapper around `lib/ast-core`'s `SemanticDiffDetector` (PLAT-007's Tier A
 * section; phase1-decision-integration.md §6b) — `analyze` auto mode's delta ingestion uses this
 * solely to decide which changed files' `CONTRACT_CHANGED` nodes enqueue into the Tier B queue.
 * Re-parsing a changed file never depends on this interface's output (spec: "changed files are
 * re-parsed regardless of detector output").
 */
export interface ISemanticDiffAnalyzer {
  /**
   * Classifies `changedLineRanges` within a single file's old/new content. Returns `[]` when the
   * file's language has no available tree-sitter grammar (best-effort — never blocks the caller's
   * re-parse) or `changedLineRanges` is empty.
   */
  analyzeFile(input: {
    filePath: string;
    oldContent: string;
    newContent: string;
    changedLineRanges: DiffLineRange[];
  }): Promise<SemanticDiffModifiedNode[]>;
}
