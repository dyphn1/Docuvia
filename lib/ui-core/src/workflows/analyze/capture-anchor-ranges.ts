import type { IGitProvider, L3AnchorRange } from "@workspace/contracts";

/**
 * Captures an L3 decision's region anchors (issue #68) at write time: the diff hunks the
 * triggering commit introduced across the decision's source files. This is the deterministic
 * alternative to agent-supplied or L2-symbol-derived anchors — the same `git diff --unified=0`
 * machinery delta ingestion already uses for semantic-diff classification, now persisted so the
 * future blame-based validity pass judges line ownership against a real region instead of
 * degenerating to file-level blame.
 *
 * `sourceFiles` must be node_key form (workspace-relative, forward slashes) -- the same form
 * `upsertDecisions` already derives via `toNodeKey` and stores in `source_files`, so each
 * anchor's `path` is byte-identical to both the diff pathspec passed to git here and the row's
 * own `source_files` entry, keeping future blame joins trivial.
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
    const ranges = await git.getChangedLineRanges(
      workspaceRoot,
      parentRef,
      commitSha,
      file,
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
