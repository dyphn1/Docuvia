import path from "path";
import type { IGraphStore } from "@workspace/contracts";
import type { CollectedFile } from "./decision-extraction.js";

/**
 * Normalizes a filesystem-relative path to the forward-slash form `l2_nodes.node_key` uses
 * (STOR-005), regardless of the OS path separator — `path.relative()` returns backslash-joined
 * segments on Windows, but `node_key` values are always derived from git-sourced paths, which
 * are forward-slash (see `lib/core/src/discovery/file-discovery.service.ts`).
 */
export function toNodeKey(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

/**
 * Resolves the `l3_nodes.l2_node_id` anchor for a decision-extraction run, per
 * docs/gitbook/analysis/phase1-decision-integration.md §3b:
 *
 * 1. Exact match: the L2 node whose `node_key` equals the workspace-relative target path.
 * 2. Directory target / no exact match: the file-level L2 node of the first collected source
 *    file (in `files` order) that has one.
 *
 * Returns `undefined` when neither resolves (an empty or not-yet-ingested graph) — the caller
 * must not invent a synthetic L2 node; `NOT NULL` on `l2_node_id` means there is nothing safe to
 * persist in that case.
 */
export function resolveAnchorL2NodeId(
  store: IGraphStore,
  workspaceRoot: string,
  resolvedTargetPath: string,
  files: CollectedFile[],
): number | undefined {
  const targetNodeKey = toNodeKey(
    path.relative(workspaceRoot, resolvedTargetPath),
  );
  const exact = store.graph.findNodeIdByNodeKey(targetNodeKey);
  if (exact !== undefined) return exact;

  for (const file of files) {
    const match = store.graph.findNodeIdByNodeKey(toNodeKey(file.relativePath));
    if (match !== undefined) return match;
  }

  return undefined;
}
