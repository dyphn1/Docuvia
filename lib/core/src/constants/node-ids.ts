/**
 * Stable topology/knowledge-export node-id prefixes ("l2:<id>" / "l3:<id>"), shared by
 * `TopologyBuilderService` and `SnapshotRendererService` — both mint ids from the same
 * underlying `l2_nodes`/`l3_nodes` row ids and must agree on the format.
 */
export const L2_NODE_ID_PREFIX = "l2:";
export const L3_NODE_ID_PREFIX = "l3:";

export function toL2NodeId(id: number | string): string {
  return `${L2_NODE_ID_PREFIX}${id}`;
}

export function toL3NodeId(id: number | string): string {
  return `${L3_NODE_ID_PREFIX}${id}`;
}
