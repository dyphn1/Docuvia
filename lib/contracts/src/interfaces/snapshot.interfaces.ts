import type { L2NodeRow, NodeLinkRow } from "./graph-store.interfaces.js";

/**
 * Renders the local knowledge graph's current state (already persisted to `IGraphStore` by
 * `init`/`sync`) into a git-diffable directory shape — `graph/nodes.jsonl`, `graph/edges.jsonl`,
 * and one markdown file per file/symbol node under `knowledge/` — that `snapshot` then packs
 * onto the hidden knowledge branch via `IKnowledgeGitService.packSnapshotToKnowledgeBranch()`.
 * Domain Core logic (`lib/core`): pure directory rendering, no git operations of its own.
 */
export interface SnapshotRenderInput {
  /** Directory to render into (typically a scratch temp dir, packed onto a branch and discarded afterwards). */
  outDir: string;
  l2Rows: L2NodeRow[];
  linkRows: NodeLinkRow[];
}

export interface SnapshotRenderResult {
  nodesWritten: number;
  edgesWritten: number;
  markdownFilesWritten: number;
  /** Per-node markdown-write failures (e.g. an unwritable path) that were skipped rather than aborting the whole render. */
  errors: string[];
}

export interface ISnapshotRenderer {
  render(input: SnapshotRenderInput): Promise<SnapshotRenderResult>;
}
