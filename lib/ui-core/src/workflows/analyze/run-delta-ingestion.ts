import crypto from "node:crypto";
import {
  docuviaFactory,
  TOKENS,
  ChangedFileStatuses,
  UTF8_ENCODING,
  type AstParseFailure,
  type CallResolutionStats,
  type ChangedFileEntry,
  type DiscoveredFile,
  type IGitProvider,
  type IGraphStore,
  type IKnowledgeGitService,
  type ILogger,
  type ISemanticDiffAnalyzer,
  type SemanticDiffModifiedNode,
} from "@workspace/contracts";
import {
  aggregateCallResolution,
  GitConstants,
  MAX_FILE_SIZE_BYTES,
} from "@workspace/contracts";
// Narrow documented exception (lib/core/src/index.ts): registry-coupled, not movable to contracts.
import { isDiscoverableSourceFile } from "@workspace/core";
import { runParseAndPersist } from "../init/run-parse-and-persist.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { mergeDeltaCallResolution } from "./call-resolution-stats.js";
import { ANALYZE_EVENTS, ANALYZE_MESSAGES } from "./analyze-messages.js";
import { isNodeKeyFormatStale } from "./node-key-format-guard.js";
import { runFullIngestion } from "./run-full-ingestion.js";
import {
  appendTierBQueueEntries,
  type TierBQueueEntry,
} from "./tier-b-queue.js";
import {
  appendTierCQueueEntries,
  type TierCQueueEntry,
} from "./tier-c-queue.js";
import {
  collectCommitMessageCandidates,
  collectContractSymbolCandidates,
} from "./tier-c-candidates.js";
import { AnalyzeResultKind, type AutoModeResult } from "./analyze-result.js";

/** Content-hash fallback algorithm for a just-changed file not yet reflected in
 *  `listTrackedFilesWithBlobHash` — mirrors `FileDiscoveryService`'s own manual-hash path. */
const CONTENT_HASH_ALGORITHM = "sha256";
const CONTENT_HASH_DIGEST_ENCODING = "hex";

/**
 * `analyze` auto mode's delta-ingestion branch (§6b) — the graph already has data and `HEAD` has
 * moved since `fromSha` (the last-ingested source sha, resolved by the caller per §6a's
 * fast-path/fallback order). Diffs `fromSha -> headSha`, re-parses added/modified/renamed source
 * files through the same `AstProcessingService` + `GraphPersister` `init`/full-ingestion use (via
 * the shared `runParseAndPersist` phase helper — its own `deleteNodesForPath()` call per parsed
 * file gives per-file replace "for free"), drops deleted files' L2 rows, and classifies each
 * *modified* file with `ISemanticDiffAnalyzer` solely to enqueue `CONTRACT_CHANGED` files into
 * the Tier B queue. Changed files are re-parsed regardless of what the detector finds.
 */
export async function runDeltaIngestion(deps: {
  workspaceRoot: string;
  logger: ILogger;
  store: IGraphStore;
  git: IGitProvider;
  knowledgeGit: IKnowledgeGitService;
  projectId: number;
  fromSha: string;
  headSha: string;
}): Promise<AutoModeResult> {
  const {
    workspaceRoot,
    logger,
    store,
    git,
    knowledgeGit,
    projectId,
    fromSha,
    headSha,
  } = deps;

  // GRPH-006's migration guard: a stale/missing `node_key` format stamp means the graph predates
  // qualified/structural keys -- an incremental re-parse of only the changed files below would
  // leave untouched files' old-flat-format keys mixed with the just-reparsed files' new-qualified
  // ones in the same graph, which `findNodeIdByNodeKey` cross-file resolution can't tell apart.
  // Force a full re-ingestion instead, exactly once, until the stamp is current again.
  if (isNodeKeyFormatStale(store)) {
    logger.info(ANALYZE_MESSAGES.NODE_KEY_FORMAT_STALE);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.DELTA_NODE_KEY_FORMAT_STALE,
    });
    return runFullIngestion({ workspaceRoot, logger, store, git });
  }

  // §6.3's backward-HEAD guard: `getChangedFilesSince(fromSha, headSha)` and readFileAtRef(headSha,
  // ...)` below both assume headSha descends from fromSha. When something moves HEAD backward while
  // the working tree/index stays at the newer state (git reset --soft, an undone amend, an aborted
  // mid-rebase), that assumption is false: the diff runs backward (real additions read as deletions)
  // and re-parsed content comes from stale git-blob history instead of what's actually on disk.
  // Bail to a full re-ingestion, which re-discovers everything from the real working tree instead of
  // trusting commit-graph position.
  if (!(await git.isAncestor(workspaceRoot, fromSha, headSha))) {
    logger.info(ANALYZE_MESSAGES.HEAD_NOT_DESCENDANT_OF_LAST_INGESTED);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.DELTA_HEAD_NOT_DESCENDANT,
      fromSha,
      headSha,
    });
    return runFullIngestion({ workspaceRoot, logger, store, git });
  }

  logger.info(ANALYZE_MESSAGES.AUTO_DELTA_INGESTION);
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.DELTA_START,
    fromSha,
    headSha,
  });

  const changedEntries = await git.getChangedFilesSince(
    workspaceRoot,
    fromSha,
    headSha,
  );
  const { toDelete, toReparse } = partitionChangedEntries(changedEntries);

  const {
    filesToParse,
    skippedOversized,
    tierBEntries,
    tierCSymbolEntries,
    changedBytes,
  } = await collectFilesToParse(deps, toReparse);
  // Tier C's commit-message candidate source (phase1-decision-integration.md §9b/§9e) — collected
  // once per delta run (not per file), independent of which files changed.
  const tierCCommitEntries = await collectCommitMessageCandidates(
    git,
    workspaceRoot,
    fromSha,
    headSha,
  );
  const tierCEntries: TierCQueueEntry[] = [
    ...tierCCommitEntries,
    ...tierCSymbolEntries,
  ];

  // §6b's locking requirement: the delta persist step (deletes + re-parse/persist + Tier B/C queue
  // + last-ingested-sha meta write) runs under the knowledge-branch lock, the same discipline
  // `snapshot`'s git-write step uses — so a concurrent `snapshot` can't read a half-updated
  // local.db mid-delta.
  let failures: AstParseFailure[] = [];
  await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, async () => {
    failures = await persistDelta(deps, {
      toDelete,
      filesToParse,
      tierBEntries,
      tierCEntries,
      changedBytes,
    });
  });

  const filesReparsed = filesToParse.length - failures.length;

  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.DELTA_SUMMARY,
    fromSha,
    headSha,
    filesReparsed,
    filesDeleted: toDelete.size,
    filesFailed: failures.length,
    filesSkippedOversized: skippedOversized.length,
    tierBQueued: tierBEntries.length,
    tierCQueued: tierCEntries.length,
  });

  return {
    kind: AnalyzeResultKind.AUTO_DELTA,
    fromSha,
    headSha,
    filesReparsed,
    filesDeleted: toDelete.size,
    filesFailed: failures.length,
    filesSkippedOversized: skippedOversized.length,
    tierBQueued: tierBEntries.length,
    tierCQueued: tierCEntries.length,
  };
}

type DeltaDeps = Parameters<typeof runDeltaIngestion>[0];

/** Splits a name-status diff into paths whose L2 rows must be dropped (deleted files + renames'
 *  old paths) and discoverable source files to re-parse (§6b: renames are delete + add). */
function partitionChangedEntries(changedEntries: ChangedFileEntry[]): {
  toDelete: Set<string>;
  toReparse: ChangedFileEntry[];
} {
  const toDelete = new Set<string>();
  const toReparse: ChangedFileEntry[] = [];

  for (const entry of changedEntries) {
    if (entry.status === ChangedFileStatuses.DELETED) {
      toDelete.add(entry.file);
      continue;
    }
    if (entry.status === ChangedFileStatuses.RENAMED && entry.oldFile) {
      toDelete.add(entry.oldFile);
    }
    if (!isDiscoverableSourceFile(entry.file)) continue;
    toReparse.push(entry);
  }

  return { toDelete, toReparse };
}

/** Reads each re-parse candidate at `headSha`, applying the same oversize guard `init`'s
 *  discovery uses, and classifies modified files for the Tier B queue and Tier C's
 *  `CONTRACT_CHANGED`-symbol candidates (phase1-decision-integration.md §9b). Also sums each
 *  parsed file's byte size into `changedBytes` — §9m item 1's commit-cap trigger data, collected
 *  here "for free" since `sizeBytes` is already computed for the oversize guard. */
async function collectFilesToParse(
  deps: DeltaDeps,
  toReparse: ChangedFileEntry[],
): Promise<{
  filesToParse: DiscoveredFile[];
  skippedOversized: { file: string; sizeBytes: number }[];
  tierBEntries: TierBQueueEntry[];
  tierCSymbolEntries: TierCQueueEntry[];
  changedBytes: number;
}> {
  const { workspaceRoot, logger, git, headSha } = deps;

  const blobHashes = await git.listTrackedFilesWithBlobHash(workspaceRoot);
  const semanticDiffAnalyzer = docuviaFactory.resolve(
    TOKENS.SemanticDiffAnalyzer,
    { logger },
  );

  const filesToParse: DiscoveredFile[] = [];
  const skippedOversized: { file: string; sizeBytes: number }[] = [];
  const tierBEntries: TierBQueueEntry[] = [];
  const tierCSymbolEntries: TierCQueueEntry[] = [];
  let changedBytes = 0;

  for (const entry of toReparse) {
    const content = await git.readFileAtRef(workspaceRoot, headSha, entry.file);
    if (content === undefined) continue; // gone by the time we read it (rare race) — skip, not fatal

    const sizeBytes = Buffer.byteLength(content, UTF8_ENCODING);
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      skippedOversized.push({ file: entry.file, sizeBytes });
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.DELTA_FILE_SKIPPED_OVERSIZED,
        file: entry.file,
        sizeBytes,
      });
      continue;
    }

    // Prefer the git blob sha (matches `FileDiscoveryService`'s own hashing scheme for tracked,
    // clean files); fall back to a content sha256 (mirrors that same service's manual-hash path)
    // for the rare case a just-changed file isn't yet reflected in `listTrackedFilesWithBlobHash`.
    const hash =
      blobHashes.get(entry.file) ??
      crypto
        .createHash(CONTENT_HASH_ALGORITHM)
        .update(content)
        .digest(CONTENT_HASH_DIGEST_ENCODING);
    filesToParse.push({ file: entry.file, hash, code: content });
    changedBytes += sizeBytes;

    const { contractChanged, findings } = await classifyChangedFile(
      deps,
      semanticDiffAnalyzer,
      entry,
      content,
    );
    if (contractChanged) {
      tierBEntries.push({ file: entry.file, commitSha: headSha });
      tierCSymbolEntries.push(
        ...collectContractSymbolCandidates(entry.file, headSha, findings),
      );
    }
  }

  return {
    filesToParse,
    skippedOversized,
    tierBEntries,
    tierCSymbolEntries,
    changedBytes,
  };
}

/** Detector classification (§6b) — modified and added files are classified (added files are
 *  diffed against an empty old-content baseline; renamed files have no meaningful "old content"
 *  at this path to diff against, so they're excluded); re-parsing is never gated on the outcome.
 *  Also returns the raw `findings` so the caller can derive Tier C's `CONTRACT_CHANGED`-symbol
 *  candidates (§9b) without re-running the detector. */
async function classifyChangedFile(
  deps: DeltaDeps,
  semanticDiffAnalyzer: ISemanticDiffAnalyzer,
  entry: ChangedFileEntry,
  newContent: string,
): Promise<{
  contractChanged: boolean;
  findings: SemanticDiffModifiedNode[];
}> {
  const { workspaceRoot, git, fromSha, headSha } = deps;
  if (
    entry.status !== ChangedFileStatuses.MODIFIED &&
    entry.status !== ChangedFileStatuses.ADDED
  )
    return { contractChanged: false, findings: [] };

  // A brand-new file has no prior commit to diff against -- diff it against an empty baseline so
  // every top-level export falls into resolvePruningLevel()'s existing "no matching old node" ->
  // CONTRACT_CHANGED branch, instead of the file being silently excluded from Tier B forever.
  const oldContent =
    entry.status === ChangedFileStatuses.ADDED
      ? ""
      : await git.readFileAtRef(workspaceRoot, fromSha, entry.file);
  if (oldContent === undefined) return { contractChanged: false, findings: [] };

  const lineRanges = await git.getChangedLineRanges(
    workspaceRoot,
    fromSha,
    headSha,
    entry.file,
  );
  if (lineRanges.length === 0) return { contractChanged: false, findings: [] };

  const findings = await semanticDiffAnalyzer.analyzeFile({
    filePath: entry.file,
    oldContent,
    newContent,
    changedLineRanges: lineRanges,
  });
  return {
    contractChanged: findings.some((f) => f.pruningLevel === 1),
    findings,
  };
}

/** The lock-held persist step: drop L2 rows for deleted/renamed-old paths, re-parse + persist the
 *  changed files via the shared `runParseAndPersist` phase helper, append the Tier B/C queues,
 *  advance the Tier B commit-cap's cumulative-bytes accumulator (§9m item 1), and stamp the
 *  last-ingested source sha. Returns the parse failures. */
async function persistDelta(
  deps: DeltaDeps,
  work: {
    toDelete: Set<string>;
    filesToParse: DiscoveredFile[];
    tierBEntries: TierBQueueEntry[];
    tierCEntries: TierCQueueEntry[];
    changedBytes: number;
  },
): Promise<AstParseFailure[]> {
  const { workspaceRoot, logger, store, projectId, headSha } = deps;
  const { toDelete, filesToParse, tierBEntries, tierCEntries, changedBytes } =
    work;

  if (toDelete.size > 0) {
    await store.withWriteLock(() => {
      for (const file of toDelete) store.graph.deleteNodesForPath(file);
    });
  }

  let failures: AstParseFailure[] = [];
  let callResolutionByFile: Record<string, CallResolutionStats> | undefined;
  if (filesToParse.length > 0) {
    const astProcessor = docuviaFactory.resolve(TOKENS.AstProcessor, {
      logger,
    });
    const graphPersister = docuviaFactory.resolve(TOKENS.GraphPersister);

    const result = await runParseAndPersist({
      astProcessor,
      graphPersister,
      store,
      workspaceRoot,
      projectId,
      filesToParse,
      // Already logged (analyze.delta.file_skipped_oversized) as each was found in
      // collectFilesToParse -- passing them again here would double-log the same skip.
      skippedOversized: [],
      tags: new Set(),
      appendLogLine: appendAnalyzeLogLine,
      logEvents: {
        parseFailure: ANALYZE_EVENTS.DELTA_PARSE_FAILURE,
        fileSkippedOversized: ANALYZE_EVENTS.DELTA_FILE_SKIPPED_OVERSIZED,
      },
    });
    failures = result.failures;
    callResolutionByFile = result.callResolutionByFile;
  }

  // Issue #221: upsert this run's per-file call-resolution counters and drop deleted files'
  // entries, so the stored map never accumulates rows for files that left the worktree.
  if (callResolutionByFile && Object.keys(callResolutionByFile).length > 0) {
    mergeDeltaCallResolution(store, callResolutionByFile, toDelete);
    const totals = aggregateCallResolution(callResolutionByFile);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.DELTA_CALL_RESOLUTION,
      ...totals,
      files: Object.keys(callResolutionByFile).length,
    });
  }

  await store.withWriteLock(() => {
    if (tierBEntries.length > 0) {
      appendTierBQueueEntries(store, tierBEntries);
    }
    if (tierCEntries.length > 0) {
      appendTierCQueueEntries(store, tierCEntries);
    }
    if (changedBytes > 0) {
      const priorBytes = Number(
        store.meta.get(GitConstants.META_KEY_TIER_B_CHANGED_BYTES) ?? 0,
      );
      store.meta.set(
        GitConstants.META_KEY_TIER_B_CHANGED_BYTES,
        String(priorBytes + changedBytes),
      );
    }
    store.meta.set(GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA, headSha);
  });

  return failures;
}
