import type { CallResolutionStats } from "../interfaces/graph-persister.interfaces.js";

/** Sums a per-file call-resolution stats map into one aggregate (issue #221) -- shared by
 *  `GraphPersisterService`'s per-run rollup, the orchestration layer's meta stamping, and
 *  `doctor`'s `call_graph_resolution` diagnostic. */
export function aggregateCallResolution(
  byFile: Record<string, CallResolutionStats>,
): CallResolutionStats {
  const aggregate: CallResolutionStats = {
    total: 0,
    resolved: 0,
    selfDiscarded: 0,
    unresolved: 0,
    unresolvable: 0,
  };
  for (const stats of Object.values(byFile)) {
    aggregate.total += stats.total;
    aggregate.resolved += stats.resolved;
    aggregate.selfDiscarded += stats.selfDiscarded;
    aggregate.unresolvable =
      (aggregate.unresolvable ?? 0) + (stats.unresolvable ?? 0);
    aggregate.unresolved += stats.unresolved;
  }
  return aggregate;
}
