import {
  docuviaFactory,
  TOKENS,
  type EdgeResolutionFileFailure,
  type EdgeResolutionProviderConfig,
  type ILogger,
  type ResolvedCallEdge,
  type TierBLanguageId,
} from "@workspace/contracts";
import type { TierBQueueEntry } from "./tier-b-queue.js";

/** Per-language honest-degradation fidelity (multi-language-lsp-support plan, Finding F) --
 *  additive alongside the aggregate `unavailableReason` below. */
export interface DegradedLanguage {
  languageId: string;
  reason: string;
}

/** Merged result of dispatching a Tier B batch's language buckets to their respective providers
 *  (Finding A/B/F) -- same field shape as the single-provider `EdgeResolutionOutcome` plus
 *  `degradedLanguages`, so existing consumers of `edges`/`filesProcessed`/`filesFailed`/
 *  `unavailableReason` keep working unmodified. */
export interface MergedEdgeResolutionOutcome {
  edges: ResolvedCallEdge[];
  filesProcessed: string[];
  filesFailed: EdgeResolutionFileFailure[];
  /** Set when at least one queued language's provider could not run at all -- every degraded
   *  language's reason, joined into one human-readable string (Finding F: aggregate, for the
   *  existing single-scalar `degradedReason` consumers). */
  unavailableReason?: string;
  /** Per-language fidelity behind `unavailableReason` above (Finding F) -- consumed by JSONL
   *  logging and `doctor`'s per-language diagnostic. Always present, empty when nothing degraded. */
  degradedLanguages: DegradedLanguage[];
}

export interface ResolveEdgesForLanguageBucketsDeps {
  workspaceRoot: string;
  logger: ILogger;
  providerConfig?: EdgeResolutionProviderConfig;
}

/**
 * Tier B's per-language dispatch/merge (multi-language-lsp-support plan, Finding A/B/F),
 * replacing `run-tier-b-batch.ts`'s old single-provider call: resolves the
 * `TOKENS.EdgeResolutionProviders` registry once, then runs each non-empty language bucket's
 * provider in turn and merges the outcomes. A bucket whose language has no registered provider
 * degrades honestly (never throws) exactly like an unavailable provider would -- this cannot
 * happen today (Slice 0's dispatch table and registry both only know about `typescript`) but
 * keeps the merge defensive for a later slice that adds a dispatch entry before its provider
 * ships.
 */
export async function resolveEdgesForLanguageBuckets(
  buckets: Partial<Record<TierBLanguageId, TierBQueueEntry[]>>,
  deps: ResolveEdgesForLanguageBucketsDeps,
): Promise<MergedEdgeResolutionOutcome> {
  const { workspaceRoot, logger, providerConfig } = deps;
  const registry = docuviaFactory.resolve(TOKENS.EdgeResolutionProviders, {
    logger,
  });

  const edges: ResolvedCallEdge[] = [];
  const filesProcessed: string[] = [];
  const filesFailed: EdgeResolutionFileFailure[] = [];
  const degradedLanguages: DegradedLanguage[] = [];

  for (const languageId of Object.keys(buckets) as TierBLanguageId[]) {
    const entries = buckets[languageId];
    if (!entries || entries.length === 0) continue;

    const buildProvider = registry[languageId];
    if (!buildProvider) {
      degradedLanguages.push({
        languageId,
        reason: `no LSP provider registered for language "${languageId}"`,
      });
      continue;
    }

    const provider = buildProvider();
    if (providerConfig) provider.configure(providerConfig);

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: entries.map((e) => e.file),
    });

    edges.push(...outcome.edges);
    filesProcessed.push(...outcome.filesProcessed);
    filesFailed.push(...outcome.filesFailed);
    if (outcome.unavailableReason) {
      degradedLanguages.push({
        languageId,
        reason: outcome.unavailableReason,
      });
    }
  }

  return {
    edges,
    filesProcessed,
    filesFailed,
    // Finding F: exactly one degraded language keeps that provider's own reason string verbatim
    // (byte-identical to the pre-registry single-provider outcome, since Slice 0 only ever has one
    // language registered) -- only >1 degraded languages in the same batch get the
    // "languageId: reason" join, since then a bare reason string would be ambiguous about which
    // language it came from.
    unavailableReason:
      degradedLanguages.length === 1
        ? degradedLanguages[0].reason
        : degradedLanguages.length > 1
          ? degradedLanguages
              .map((d) => `${d.languageId}: ${d.reason}`)
              .join("; ")
          : undefined,
    degradedLanguages,
  };
}
