import fs from "fs";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  HookNames,
  L3DecisionSources,
  type ILogger,
} from "@workspace/contracts";
import { ANALYZE_EVENTS, ANALYZE_MESSAGES } from "./analyze-messages.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { collectSourceFiles } from "./decision-extraction.js";
import { persistDecisions } from "./persist-l3-decisions.js";
import {
  readPendingDecisions,
  writePendingDecisions,
  type PendingL3Decision,
} from "./pending-l3-decisions-store.js";
import { readHooksConfig } from "../hooks/hooks-config-store.js";
import {
  AnalyzeResultKind,
  type AnalyzeResult,
  type DecisionNodeType,
  type ExtractedDecision,
} from "./analyze-result.js";

/** `runFlushStagedL3`'s zero-work result shapes (disabled toggle / nothing staged / nothing in
 *  this commit's diff) all share this shape -- pulled out so every early-return site stays a
 *  one-liner. */
function noopResult(
  skippedDisabled: boolean,
  stillPending: number,
  commitSha: string | null,
): AnalyzeResult {
  return {
    kind: AnalyzeResultKind.FLUSH_STAGED_L3,
    skippedDisabled,
    flushed: 0,
    deduped: 0,
    stillPending,
    commitSha,
  };
}

/** Groups `entries` by `filePath` -- `persistDecisions` operates per-target-path, so every
 *  staged decision for the same file is flushed together in one call (one anchor resolution, one
 *  store open). Preserves insertion order (a `Map` iterates in insertion order), matching the
 *  order entries were staged in. */
function groupByFilePath(
  entries: PendingL3Decision[],
): Map<string, PendingL3Decision[]> {
  const groups = new Map<string, PendingL3Decision[]>();
  for (const entry of entries) {
    const existing = groups.get(entry.filePath);
    if (existing) existing.push(entry);
    else groups.set(entry.filePath, [entry]);
  }
  return groups;
}

/** Partitions `pending` into entries whose `filePath` appears in `changedFiles` (`toFlush`) and
 *  those that don't (`stillPending`) -- pulled out of `runFlushStagedL3` so that function stays
 *  under the cyclomatic-complexity budget (mirrors the `dispatchAgentAuthored` split precedent in
 *  the CLI's `analyze.ts`). */
function partitionByDiffMatch(
  pending: PendingL3Decision[],
  changedFiles: Set<string>,
): { toFlush: PendingL3Decision[]; stillPending: PendingL3Decision[] } {
  const toFlush: PendingL3Decision[] = [];
  const stillPending: PendingL3Decision[] = [];
  for (const entry of pending) {
    if (changedFiles.has(entry.filePath)) toFlush.push(entry);
    else stillPending.push(entry);
  }
  return { toFlush, stillPending };
}

function toExtractedDecisions(
  entries: PendingL3Decision[],
): ExtractedDecision[] {
  return entries.map((entry) => ({
    title: entry.title,
    content: entry.content,
    nodeType: entry.nodeType as DecisionNodeType,
    confidence: entry.confidence,
  }));
}

/** The `toFlush` loop's per-file-group outcome -- `dropped` means the entries were removed from
 *  the staging file without ever being persisted (the file was deleted by this commit, see
 *  `FLUSH_STAGED_L3_FILE_DELETED`'s doc comment); `retry` means `persistDecisions` swallowed a
 *  skip (no graph to attach yet -- `{persisted: 0, deduped: 0}` without throwing) and the entries
 *  must stay staged for a future flush, not be silently lost. */
interface FlushGroupOutcome {
  persisted: number;
  deduped: number;
  dropped: PendingL3Decision[];
  retry: PendingL3Decision[];
}

/**
 * Flushes one file-group's staged decisions. Never throws for the "nothing to attach yet" case
 * (`persistDecisions`'s own contract) -- only a genuine, unexpected failure inside
 * `persistDecisions` (e.g. a `store.l3.upsertDecision` throw) propagates out, which
 * `runFlushStagedL3`'s caller-level try/catch handles by aborting the whole flush (durability
 * before dequeue, issue #42 §8.2 step 7).
 */
async function flushFileGroup(
  workspaceRoot: string,
  logger: ILogger,
  filePath: string,
  entries: PendingL3Decision[],
  commitSha: string | undefined,
): Promise<FlushGroupOutcome> {
  const resolvedPath = path.resolve(workspaceRoot, filePath);

  // A staged entry's file no longer exists at HEAD -- it was deleted by the very commit that
  // would flush it. collectSourceFiles()'s fs.statSync() would throw ENOENT on it, and (per the
  // durability rule) that throw would poison every future flush forever unless guarded here.
  // Nothing survives to anchor a decision to, so this is a deliberate drop, not a retry.
  if (!fs.existsSync(resolvedPath)) {
    logger.warn(ANALYZE_MESSAGES.FLUSH_STAGED_L3_FILE_DELETED(filePath), {
      droppedCount: entries.length,
    });
    return { persisted: 0, deduped: 0, dropped: entries, retry: [] };
  }

  const { files, droppedFiles } = collectSourceFiles(
    resolvedPath,
    workspaceRoot,
    logger,
  );
  if (droppedFiles.length > 0) {
    logger.warn(ANALYZE_MESSAGES.FILES_DROPPED(droppedFiles.length), {
      droppedFiles,
      filePath,
    });
  }

  const result = await persistDecisions({
    workspaceRoot,
    logger,
    resolvedTargetPath: resolvedPath,
    files,
    decisions: toExtractedDecisions(entries),
    source: L3DecisionSources.AGENT_AUTHORED,
    extractionModel: null,
    commitSha,
  });

  // persistDecisions never throws for "no graph to attach yet" (DB missing, no project row, or
  // an unresolvable anchor) -- it warns and returns {persisted: 0, deduped: 0} instead. That is
  // NOT the same as success: these entries must stay staged for a future flush to retry, not be
  // dequeued as if they'd landed (advisor-flagged trap -- {0,0} is a swallowed skip, not a
  // confirmed write).
  if (result.persisted + result.deduped === 0) {
    return { persisted: 0, deduped: 0, dropped: [], retry: entries };
  }

  return {
    persisted: result.persisted,
    deduped: result.deduped,
    dropped: [],
    retry: [],
  };
}

/**
 * `docuvia analyze --flush-staged-l3` (issue #42, Decision 2's two-stage stage-and-flush design
 * §8.2) -- the post-commit hook's other line (`POST_COMMIT_HOOK_CONTENT`, `git-constants.ts`):
 * drains `.docuvia/pending-l3-decisions.json` entries whose `filePath` is in the *triggering*
 * commit's changed-file list, persisting each through `persist-l3-decisions.ts` with
 * `source: L3DecisionSources.AGENT_AUTHORED` and this commit's exact sha (not whatever `HEAD`
 * happens to be when the DB write executes -- see `persistDecisions`'s `commitSha` doc comment).
 * Entries staged for a file *not* in this commit (staged mid-session but not yet committed, or
 * committed in a later commit) are left untouched in the staging file.
 *
 * Matching invariant (issue #53 finding 4): staged `filePath`s are workspace-relative node_keys
 * (`toNodeKey(path.relative(workspaceRoot, …))`, see `pending-l3-decisions-store.ts`), while
 * `getFilesChangedByCommit` returns git-repo-relative paths — the two only line up when
 * `workspaceRoot` is the git top-level, which holds for the post-commit hook (git always runs
 * hooks at the worktree root) but NOT for a manual `--flush-staged-l3` invoked from a
 * subdirectory. In that subdirectory case the whole `changedFiles`-membership test silently
 * matches nothing and every entry stays pending until a future flush runs from the repo root.
 * No runtime guard is raised for it (a commit that simply doesn't touch any staged file is the
 * normal, silent same-result case, so a warning here would be noise on every unrelated commit);
 * the assumption is documented here and in `docs/gitbook/user-guide/cli/analyze.md` Mode D
 * instead.
 *
 * Self-gates first, before any staging-file I/O: this runs backgrounded/fire-and-forget from
 * `POST_COMMIT_HOOK_CONTENT` (`... > /dev/null 2>&1 &`), so there is no exit code for anything to
 * react to the way Part E's synchronous pre-push `&&` chain does -- checking `commit-l3-write`
 * internally here is simpler and avoids a second `npx` spawn.
 */
export async function runFlushStagedL3(deps: {
  workspaceRoot: string;
  logger: ILogger;
}): Promise<AnalyzeResult> {
  const { workspaceRoot, logger } = deps;

  const hooksConfig = await readHooksConfig(workspaceRoot, logger);
  if (!hooksConfig[HookNames.COMMIT_L3_WRITE]) {
    logger.info(ANALYZE_MESSAGES.FLUSH_STAGED_L3_DISABLED);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FLUSH_STAGED_L3_DISABLED,
    });
    return noopResult(true, 0, null);
  }

  const pending = await readPendingDecisions(workspaceRoot, logger);
  if (pending.length === 0) {
    logger.info(ANALYZE_MESSAGES.FLUSH_STAGED_L3_EMPTY);
    return noopResult(false, 0, null);
  }

  const git = docuviaFactory.resolve(TOKENS.GitProvider);
  const headSha = await git.getHeadSha(workspaceRoot);
  // Post-commit fires post-commit, by definition -- HEAD *is* the just-made commit. An
  // unborn/headless HEAD here is essentially unreachable (a post-commit hook can't fire without a
  // commit existing), but handled defensively rather than assumed away: nothing to diff against,
  // so every staged entry is left untouched for the next flush.
  if (!headSha) {
    return noopResult(false, pending.length, null);
  }

  const changedFiles = new Set(
    await git.getFilesChangedByCommit(workspaceRoot, headSha),
  );

  const { toFlush, stillPending } = partitionByDiffMatch(pending, changedFiles);
  if (toFlush.length === 0) {
    // Nothing staged matches this commit's diff -- leave the staging file completely untouched
    // (not even a no-op rewrite) so a mid-loop-failure-style test can assert byte-identical
    // survival, not just equivalent content. Note this is the *normal* path whenever a commit
    // doesn't touch any staged file (entries for other files legitimately stay pending for a
    // later commit), so it must stay silent -- the "workspaceRoot isn't the git top-level"
    // subdirectory mismatch (see the module doc comment's matching invariant) is one possible
    // cause among several and is documented there, not flagged here where it would be noise on
    // every unrelated commit.
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FLUSH_STAGED_L3_SUMMARY,
      flushed: 0,
      stillPending: stillPending.length,
      commitSha: headSha,
    });
    return noopResult(false, stillPending.length, headSha);
  }

  const groups = groupByFilePath(toFlush);
  let flushed = 0;
  let deduped = 0;
  let droppedDeleted = 0;
  const retryLater: PendingL3Decision[] = [];

  try {
    for (const [filePath, entries] of groups) {
      const outcome = await flushFileGroup(
        workspaceRoot,
        logger,
        filePath,
        entries,
        headSha,
      );
      flushed += outcome.persisted;
      deduped += outcome.deduped;
      droppedDeleted += outcome.dropped.length;
      retryLater.push(...outcome.retry);
    }
  } catch (err) {
    // Durability before dequeue (issue #42 §8.2 step 7): a persist call throwing mid-loop must
    // not drop the unflushed remainder. The staging file is never rewritten on this path -- it is
    // left byte-identical to how `readPendingDecisions` found it, for the next flush to retry.
    // Any groups that DID persist before the throw are safe to redo next time too: upsertDecision
    // is content-hash-deduped, so redoing an already-landed write is a harmless no-op, not a
    // duplicate row.
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(ANALYZE_MESSAGES.FLUSH_STAGED_L3_ERROR(message));
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FLUSH_STAGED_L3_SUMMARY,
      error: message,
      commitSha: headSha,
    });
    return noopResult(false, pending.length, headSha);
  }

  // Only rewritten after every toFlush entry has been attempted and none threw -- see the
  // try/catch above for the failure path that skips this write entirely.
  const finalStillPending = [...stillPending, ...retryLater];
  await writePendingDecisions(workspaceRoot, finalStillPending);

  logger.info(
    ANALYZE_MESSAGES.FLUSH_STAGED_L3_SUMMARY(flushed, finalStillPending.length),
  );
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.FLUSH_STAGED_L3_SUMMARY,
    flushed,
    deduped,
    stillPending: finalStillPending.length,
    droppedDeleted,
    commitSha: headSha,
  });

  return {
    kind: AnalyzeResultKind.FLUSH_STAGED_L3,
    skippedDisabled: false,
    flushed,
    deduped,
    stillPending: finalStillPending.length,
    commitSha: headSha,
  };
}
