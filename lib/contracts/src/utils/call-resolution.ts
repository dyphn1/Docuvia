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
    external: 0,
    unknownReceiver: 0,
  };
  for (const stats of Object.values(byFile)) {
    aggregate.total += stats.total;
    aggregate.resolved += stats.resolved;
    aggregate.selfDiscarded += stats.selfDiscarded;
    aggregate.unresolvable =
      (aggregate.unresolvable ?? 0) + (stats.unresolvable ?? 0);
    aggregate.external = (aggregate.external ?? 0) + (stats.external ?? 0);
    aggregate.unknownReceiver =
      (aggregate.unknownReceiver ?? 0) + (stats.unknownReceiver ?? 0);
    aggregate.unresolved += stats.unresolved;
  }
  return aggregate;
}

/**
 * Issue #230: the denominator every call-graph health rate must use — the call sites Tier A's
 * name-based resolution is actually *supposed* to be able to resolve.
 *
 * Subtracts, in order of when each exclusion was introduced:
 *   - `selfDiscarded` (#221) — resolved to the caller's own node, persisted nowhere by design.
 *   - `unresolvable` (#192) — no statically nameable callee ('arg-chain', 'computed').
 *   - `external` (#230) — provably outside the analyzed project (`node_modules`, node builtins,
 *     ambient globals). Docuvia can never own a node for these.
 *   - `unknownReceiver` (#230) — member call whose receiver declaration Tier A cannot see.
 *
 * Each is a *structural* limit, not a resolution failure. Kept as one shared function (rather
 * than re-derived at each call site) so `GraphPersisterService`'s per-run rollup and `doctor`'s
 * `call_graph_resolution` diagnostic can never drift apart, and so the raw counters stay
 * individually stamped in meta — any consumer can still re-derive the older, wider denominators.
 */
export function callResolutionDenominator(stats: CallResolutionStats): number {
  return (
    stats.total -
    stats.selfDiscarded -
    (stats.unresolvable ?? 0) -
    (stats.external ?? 0) -
    (stats.unknownReceiver ?? 0)
  );
}
