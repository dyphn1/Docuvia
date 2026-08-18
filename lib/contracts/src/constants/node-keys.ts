/**
 * `node_key` conventions shared across `lib/core` (Tier A's AST persister, `analyze`'s
 * ingestion guard) and `lib/ui-core` (the `node_key` format stamp written/read by
 * `stamp-full-ingestion-for-tier-b.ts` and `node-key-format-guard.ts`). Per Virtual Contracts
 * §8, a value both the Domain Core and the Orchestration layer need lives in contracts rather
 * than being exported from `lib/core`.
 */

/** Format-version stamp this codebase currently produces (GRPH-006) — read/written by the
 *  `analyze` ingestion guard (`node-key-format-guard.ts`) to detect a pre-qualified-key graph
 *  before an incremental delta re-parse would otherwise silently mix the two formats. */
export const CURRENT_NODE_KEY_FORMAT_VERSION = "2";
