import {
  CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX,
  resolveActiveCallsProjectionCallerPolicy,
  type IGraphStore,
} from "@workspace/contracts";

/**
 * Records the policy used for every call edge after a full graph replacement. This is separate
 * from strict-proof completeness: skipped oversized files leave no stored call edges, but must
 * not make a fresh graph look like a legacy ScopeResolver graph to impact reads.
 */
export function stampFullCallsProjectionCallerPolicy(
  meta: IGraphStore["meta"],
  projectId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  meta.set(
    `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}${projectId}`,
    resolveActiveCallsProjectionCallerPolicy(env),
  );
}
