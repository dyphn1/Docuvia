import path from "path";
import type { TierBQueueEntry } from "./tier-b-queue.js";

/**
 * D4's per-language dispatch table (phase1-decision-integration.md §8e): queue consumption
 * dispatches by language through this table, never a hardcoded TS check. Slice 3 ships the TS/JS
 * plugin only; every other extension has no entry and stays at AST precision (§8b's honest
 * degradation, extended to "never attempted" for a language with no plugin yet).
 *
 * A real per-language *plugin* would carry its own edge-resolution provider; Slice 3 only has one
 * provider (`TypescriptLspEdgeProvider`) so the "plugin" is simply "supported, route to the LSP
 * provider" vs "unsupported, skip with a log line" -- the shape still generalizes: adding a
 * second language later means adding an entry here and a second provider, not touching this
 * dispatch logic.
 */
export const TIER_B_SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

export const TIER_B_LANGUAGE_ID = "typescript" as const;

/** `undefined` when `file`'s extension has no registered plugin (§8e: skip with a log line, stay
 *  AST-level) -- the dispatch table is the single source of truth callers should consult rather
 *  than re-checking extensions inline. */
export function dispatchTierBLanguage(file: string): string | undefined {
  const extension = path.extname(file);
  return TIER_B_SUPPORTED_EXTENSIONS.has(extension)
    ? TIER_B_LANGUAGE_ID
    : undefined;
}

export interface TierBLanguagePartition {
  supported: TierBQueueEntry[];
  unsupported: TierBQueueEntry[];
}

/** Splits a Tier B queue into language-supported (routed to the LSP provider) and unsupported
 *  (skipped, §8e) entries. */
export function partitionQueueByLanguage(
  entries: TierBQueueEntry[],
): TierBLanguagePartition {
  const supported: TierBQueueEntry[] = [];
  const unsupported: TierBQueueEntry[] = [];
  for (const entry of entries) {
    if (dispatchTierBLanguage(entry.file)) supported.push(entry);
    else unsupported.push(entry);
  }
  return { supported, unsupported };
}
