import type { IGitProvider, L3AnchorRange } from "@workspace/contracts";
import { toNodeKey } from "./anchor-resolution.js";

/**
 * Captures an L3 decision's region anchors (issue #68) at write time: the diff hunks the
 * triggering commit introduced across the decision's source files. This is the deterministic
 * alternative to agent-supplied or L2-symbol-derived anchors — the same `git diff --unified=0`
 * machinery delta ingestion already uses for semantic-diff classification, now persisted so the
 * future blame-based validity pass judges line ownership against a real region instead of
 * degenerating to file-level blame.
 *
 * Returns `null` when there is no commit to diff against (null/unresolvable sha — e.g. an
 * unborn HEAD), and `[]` when the commit touches none of the files or git yields no hunks;
 * both mean "unknown region", which stores NULL rather than a fabricated range. Per-file git
 * failures degrade to "no hunks for that file" (`getChangedLineRanges`'s own contract).
 */
export async function captureAnchorRanges(deps: {
  git: IGitProvider;
  workspaceRoot: string;
  commitSha: string | null | undefined;
  sourceFiles: string[];
}): Promise<L3AnchorRange[] | null> {
  const { git, workspaceRoot, commitSha, sourceFiles } = deps;
  if (!commitSha || sourceFiles.length === 0) return null;

  const parentRef = `${commitSha}^`;
  const anchors: L3AnchorRange[] = [];
  for (const file of sourceFiles) {
    // node_key form is what staged entries / persisted source_files use; git paths are
    // repo-relative forward-slash too, but normalize defensively for backslash callers.
    const ranges = await git.getChangedLineRanges(
      workspaceRoot,
      parentRef,
      commitSha,
      toNodeKey(file),
    );
    for (const range of ranges) {
      anchors.push({
        path: file,
        startRow: range.startRow,
        endRow: range.endRow,
      });
    }
  }
  return anchors;
}
