import { CURRENT_NODE_KEY_FORMAT_VERSION, GitConstants } from "@workspace/core";
import type { IGraphStore } from "@workspace/contracts";

/** GRPH-006's migration guard: true when the graph's stamped `node_key` format version is
 *  missing (pre-Slice graph, or a graph that predates this stamp entirely) or older than what
 *  this codebase currently produces -- an incremental delta re-parse on top of that graph would
 *  silently mix old-flat and new-qualified `node_key` formats in the same project, which
 *  `findNodeIdByNodeKey` cross-file resolution can't tell apart. Callers must force a full
 *  re-ingestion instead of a delta when this is true. */
export function isNodeKeyFormatStale(store: IGraphStore): boolean {
  const stamped = store.meta.get(GitConstants.META_KEY_NODE_KEY_FORMAT_VERSION);
  return stamped !== CURRENT_NODE_KEY_FORMAT_VERSION;
}
