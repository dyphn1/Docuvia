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

  const blobHashes = await git.listTrackedFilesWithBlobHash(workspaceRoot);
  const semanticDiffAnalyzer = docuviaFactory.resolve(
    TOKENS.SemanticDiffAnalyzer,
    { logger },
  );

  const filesToParse: DiscoveredFile[] = [];
  const skippedOversized: { file: string; sizeBytes: number }[] = [];
  const tierBEntries: TierBQueueEntry[] = [];

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

    // Classification only for a true in-place modification — added/renamed files have no
    // meaningful "old content" at this path to diff against (§6b: renames are delete + add).
    if (entry.status === "modified") {
      const oldContent = await git.readFileAtRef(
        workspaceRoot,
        fromSha,
        entry.file,
      );
      if (oldContent !== undefined) {
        const lineRanges = await git.getChangedLineRanges(
          workspaceRoot,
          fromSha,
          headSha,
          entry.file,
        );
        if (lineRanges.length > 0) {
          const findings = await semanticDiffAnalyzer.analyzeFile({
            filePath: entry.file,
            oldContent,
            newContent: content,
            changedLineRanges: lineRanges,
          });
          if (findings.some((f) => f.pruningLevel === 1)) {
            tierBEntries.push({ file: entry.file, commitSha: headSha });
          }
        }
      }
    }
  }

  let failures: AstParseFailure[] = [];

  // §6b's locking requirement: the delta persist step (deletes + re-parse/persist + Tier B queue
  // + last-ingested-sha meta write) runs under the knowledge-branch lock, the same discipline
  // `snapshot`'s git-write step uses — so a concurrent `snapshot` can't read a half-updated
  // local.db mid-delta.
  await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, async () => {
    if (toDelete.size > 0) {
      await store.withWriteLock(() => {
        for (const file of toDelete) store.graph.deleteNodesForPath(file);
      });
    }

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
      store.meta.set(GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA, headSha);
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
  };
}
