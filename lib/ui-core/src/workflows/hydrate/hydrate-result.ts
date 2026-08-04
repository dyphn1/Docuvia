/** Result of the `hydrate` workflow — mirrors `HydrationResult` (see `@workspace/contracts`). */
export interface HydrateResult {
  hydrated: boolean;
  knowledgeSha?: string;
  nodesLoaded: number;
  edgesLoaded: number;
  edgesDropped: number;
  refused?: boolean;
  refusalReason?: "pending-local-write" | "catastrophic-shrink";
}
