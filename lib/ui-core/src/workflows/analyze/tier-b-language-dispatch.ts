import path from "path";
import {
  TIER_B_LANGUAGE_IDS,
  type TierBLanguageId,
} from "@workspace/contracts";
import type { TierBQueueEntry } from "./tier-b-queue.js";

/**
 * D4's per-language dispatch table (phase1-decision-integration.md §8e; multi-language-lsp-support
 * plan, Finding A/B): queue consumption dispatches by language through this table, never a
 * hardcoded TS check. Slice 0 ships the TS/JS entries only; every other extension has no entry and
 * stays at AST precision (§8b's honest degradation, extended to "never attempted" for a language
 * with no plugin yet). Each later language slice adds its own extensions here, keyed by the same
 * `TierBLanguageId` the `TOKENS.EdgeResolutionProviders` registry uses -- one shared vocabulary
 * for both sides.
 */
export const TIER_B_LANGUAGE_ID_BY_EXTENSION: Readonly<
  Record<string, TierBLanguageId>
> = {
  ".ts": TIER_B_LANGUAGE_IDS.TYPESCRIPT,
  ".tsx": TIER_B_LANGUAGE_IDS.TYPESCRIPT,
  ".mts": TIER_B_LANGUAGE_IDS.TYPESCRIPT,
  ".cts": TIER_B_LANGUAGE_IDS.TYPESCRIPT,
  ".js": TIER_B_LANGUAGE_IDS.TYPESCRIPT,
  ".jsx": TIER_B_LANGUAGE_IDS.TYPESCRIPT,
  ".mjs": TIER_B_LANGUAGE_IDS.TYPESCRIPT,
  ".cjs": TIER_B_LANGUAGE_IDS.TYPESCRIPT,
  ".py": TIER_B_LANGUAGE_IDS.PYTHON,
  ".go": TIER_B_LANGUAGE_IDS.GO,
  ".rs": TIER_B_LANGUAGE_IDS.RUST,
};

/** `undefined` when `file`'s extension has no registered plugin (§8e: skip with a log line, stay
 *  AST-level) -- the dispatch table is the single source of truth callers should consult rather
 *  than re-checking extensions inline. */
export function dispatchTierBLanguage(
  file: string,
): TierBLanguageId | undefined {
  return TIER_B_LANGUAGE_ID_BY_EXTENSION[path.extname(file)];
}

export interface TierBLanguagePartition {
  /** Queued entries bucketed by language id (multi-language-lsp-support plan, Finding A) -- a
   *  language with no queued files this run simply has no key here, rather than an empty array. */
  buckets: Partial<Record<TierBLanguageId, TierBQueueEntry[]>>;
  /** Entries whose extension has no dispatch entry at all (§8e), skipped with a log line. */
  unsupported: TierBQueueEntry[];
}

/** Splits a Tier B queue into per-language buckets (each routed to that language's LSP provider,
 *  Finding A) plus the entries with no dispatch entry at all (skipped, §8e). */
export function partitionQueueByLanguage(
  entries: TierBQueueEntry[],
): TierBLanguagePartition {
  const buckets: Partial<Record<TierBLanguageId, TierBQueueEntry[]>> = {};
  const unsupported: TierBQueueEntry[] = [];
  for (const entry of entries) {
    const languageId = dispatchTierBLanguage(entry.file);
    if (!languageId) {
      unsupported.push(entry);
      continue;
    }
    (buckets[languageId] ??= []).push(entry);
  }
  return { buckets, unsupported };
}
