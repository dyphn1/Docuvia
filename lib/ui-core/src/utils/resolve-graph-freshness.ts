import {
  docuviaFactory,
  GitConstants,
  TOKENS,
  type IGraphStore,
} from "@workspace/contracts";
import type { GraphFreshness } from "../workflows/status/status-result.js";

/** The three `GraphFreshness` values (issue #193), named once for every consumer. */
export const GraphFreshnessStates = {
  FRESH: "fresh",
  STALE: "stale",
  UNKNOWN: "unknown",
} as const satisfies Record<string, GraphFreshness>;

export interface ResolvedGraphFreshness {
  state: GraphFreshness;
  /** `lastIngestedSourceSha`; present whenever `state` is `fresh` or `stale`. */
  graphSourceSha?: string;
  /** Source `HEAD`; present whenever `state` is `fresh` or `stale`. */
  headSha?: string;
}

const UNKNOWN: ResolvedGraphFreshness = { state: GraphFreshnessStates.UNKNOWN };

/**
 * Issue #193 (shared by `status` and, since #508 Phase 3 D8, `impact`): the cheap
 * HEAD-vs-last-ingested comparison. Freshness is HEAD-sha based by design (PLAT-007's rejected
 * alternatives): an uncommitted working-tree edit is not staleness. Fail-open to `unknown` on any
 * missing input or error -- freshness must never crash the command that asks for it.
 */
export async function resolveGraphFreshness(
  workspaceRoot: string,
  store: IGraphStore,
): Promise<ResolvedGraphFreshness> {
  try {
    if (!docuviaFactory.has(TOKENS.GitProvider)) return UNKNOWN;
    const git = docuviaFactory.resolve(TOKENS.GitProvider);
    const headSha = await git.getHeadSha(workspaceRoot);
    if (!headSha) return UNKNOWN;
    const graphSourceSha = store.meta.get(
      GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
    );
    if (!graphSourceSha) return UNKNOWN;
    return {
      state:
        graphSourceSha === headSha
          ? GraphFreshnessStates.FRESH
          : GraphFreshnessStates.STALE,
      graphSourceSha,
      headSha,
    };
  } catch {
    return UNKNOWN;
  }
}
