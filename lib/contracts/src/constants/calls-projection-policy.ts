/** Persisted identifier for the caller-attribution rule used by `node_links(calls)`. */
export const CallsProjectionCallerPolicies = {
  SCOPE_RESOLVER_V1: "scope-resolver-v1",
  EXACT_ENCLOSING_V1: "exact-enclosing-v1",
  EXACT_ENCLOSING_V2: "exact-enclosing-v2",
} as const;

export type CallsProjectionCallerPolicy =
  (typeof CallsProjectionCallerPolicies)[keyof typeof CallsProjectionCallerPolicies];

export function isCallsProjectionCallerPolicy(
  value: unknown,
): value is CallsProjectionCallerPolicy {
  return (
    typeof value === "string" &&
    Object.values(CallsProjectionCallerPolicies).some(
      (policy) => policy === value,
    )
  );
}

/** Keep the historical projection as default until exact callers preserve the full impact set. */
export const DEFAULT_CALLS_PROJECTION_CALLER_POLICY: CallsProjectionCallerPolicy =
  CallsProjectionCallerPolicies.SCOPE_RESOLVER_V1;

/** Project-scoped marker written after a complete graph persistence pass. */
export const CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX =
  "graph.calls-projection.caller-policy.v1:";

/** Snapshot metadata capability version, independent of the outer snapshot format. */
export const SNAPSHOT_CALLS_PROJECTION_CALLER_POLICY_VERSION = 1;
