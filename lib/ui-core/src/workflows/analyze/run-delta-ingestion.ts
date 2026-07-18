import crypto from "node:crypto";
import {
  docuviaFactory,
  TOKENS,
  type AstParseFailure,
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
  GitConstants,
  isDiscoverableSourceFile,
  MAX_FILE_SIZE_BYTES,
} from "@workspace/core";
import { runParseAndPersist } from "../init/run-parse-and-persist.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { ANALYZE_MESSAGES } from "./analyze-messages.js";
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
import type { AutoModeResult } from "./analyze-result.js";

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

  logger.info(ANALYZE_MESSAGES.AUTO_DELTA_INGESTION);
  await appendAnalyzeLogLine(workspaceRoot, {
    event: "analyze.delta.start",
    fromSha,
    headSha,
  });

  const changedEntries = await git.getChangedFilesSince(
    workspaceRoot,
    fromSha,
    headSha,
  );
  const { toDelete, toReparse } = partitionChangedEntries(changedEntries);

  const { filesToParse, skippedOversized, tierBEntries, tierCSymbolEntries } =
    await collectFilesToParse(deps, toReparse);
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
      skippedOversized,
      tierBEntries,
      tierCEntries,
    });
  });

  const filesReparsed = filesToParse.length - failures.length;

  await appendAnalyzeLogLine(workspaceRoot, {
    event: "analyze.delta.summary",
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
    kind: "autoDelta",
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
    if (entry.status === "deleted") {
      toDelete.add(entry.file);
      continue;
    }
    if (entry.status === "renamed" && entry.oldFile) {
      toDelete.add(entry.oldFile);
    }
    if (!isDiscoverableSourceFile(entry.file)) continue;
    toReparse.push(entry);
  }

  return { toDelete, toReparse };
}

/** Reads each re-parse candidate at `headSha`, applying the same oversize guard `init`'s
 *  discovery uses, and classifies modified files for the Tier B queue and Tier C's
 *  `CONTRACT_CHANGED`-symbol candidates (phase1-decision-integration.md §9b). */
async function collectFilesToParse(
  deps: DeltaDeps,
  toReparse: ChangedFileEntry[],
): Promise<{
  filesToParse: DiscoveredFile[];
  skippedOversized: { file: string; sizeBytes: number }[];
  tierBEntries: TierBQueueEntry[];
  tierCSymbolEntries: TierCQueueEntry[];
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

  for (const entry of toReparse) {
    const content = await git.readFileAtRef(workspaceRoot, headSha, entry.file);
    if (content === undefined) continue; // gone by the time we read it (rare race) — skip, not fatal

    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      skippedOversized.push({ file: entry.file, sizeBytes });
      await appendAnalyzeLogLine(workspaceRoot, {
        event: "analyze.delta.file_skipped_oversized",
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
      crypto.createHash("sha256").update(content).digest("hex");
    filesToParse.push({ file: entry.file, hash, code: content });

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

  return { filesToParse, skippedOversized, tierBEntries, tierCSymbolEntries };
}

/** Detector classification (§6b) — only a true in-place modification is classified (added/renamed
 *  files have no meaningful "old content" at this path to diff against); re-parsing is never
 *  gated on the outcome. Also returns the raw `findings` so the caller can derive Tier C's
 *  `CONTRACT_CHANGED`-symbol candidates (§9b) without re-running the detector. */
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
  if (entry.status !== "modified")
    return { contractChanged: false, findings: [] };

  const oldContent = await git.readFileAtRef(
    workspaceRoot,
    fromSha,
    entry.file,
  );
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
 *  changed files via the shared `runParseAndPersist` phase helper, append the Tier B/C queues, and
 *  stamp the last-ingested source sha. Returns the parse failures. */
async function persistDelta(
  deps: DeltaDeps,
  work: {
    toDelete: Set<string>;
    filesToParse: DiscoveredFile[];
    skippedOversized: { file: string; sizeBytes: number }[];
    tierBEntries: TierBQueueEntry[];
    tierCEntries: TierCQueueEntry[];
  },
): Promise<AstParseFailure[]> {
  const { workspaceRoot, logger, store, projectId, headSha } = deps;
  const {
    toDelete,
    filesToParse,
    skippedOversized,
    tierBEntries,
    tierCEntries,
  } = work;

  if (toDelete.size > 0) {
    await store.withWriteLock(() => {
      for (const file of toDelete) store.graph.deleteNodesForPath(file);
    });
  }

  let failures: AstParseFailure[] = [];
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
      skippedOversized,
      tags: new Set(),
    });
    failures = result.failures;
  }

  await store.withWriteLock(() => {
    if (tierBEntries.length > 0) {
      appendTierBQueueEntries(store, tierBEntries);
    }
    if (tierCEntries.length > 0) {
      appendTierCQueueEntries(store, tierCEntries);
    }
    store.meta.set(GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA, headSha);
  });

  return failures;
}
