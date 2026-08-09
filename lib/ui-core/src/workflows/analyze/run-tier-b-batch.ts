import fs from "node:fs";
import path from "node:path";
import {
  LinkTypes,
  type IGitProvider,
  type IGraphStore,
  type IKnowledgeGitService,
  type ILogger,
  type EdgeResolutionProviderConfig,
  type TierBLanguageId,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { ANALYZE_EVENTS, ANALYZE_MESSAGES } from "./analyze-messages.js";
import { AnalyzeResultKind, type TierBBatchResult } from "./analyze-result.js";
import { readTierBQueue, type TierBQueueEntry } from "./tier-b-queue.js";
import { queueFullTierBResync } from "./queue-full-tier-b-resync.js";
import { partitionQueueByLanguage } from "./tier-b-language-dispatch.js";
import { isTierBCommitCapExceeded } from "./tier-b-commit-cap.js";
import { runTierCDrain } from "./run-tier-c-drain.js";
import {
  resolveEdgesForLanguageBuckets,
  type MergedEdgeResolutionOutcome,
} from "./tier-b-edge-resolution-orchestrator.js";

interface PendingTierBBatch {
  headSha: string;
  remainingQueue: TierBQueueEntry[];
}

/** Pino's numeric "error" level -- `doctor`'s `runLogsDiagnostics`/`scanLogFiles` scans every
 *  `.docuvia/logs/*.log` line for `entry.level >= 50` to decide whether a past run had a real
 *  failure worth surfacing. Every event this file writes via `appendAnalyzeLogLine` was missing
 *  `level` entirely (`entry.level && ...` short-circuits `undefined` to false), so a degraded
 *  Tier B batch could never trip that check -- doctor kept reporting the LOGS category healthy
 *  right after a run that produced zero edges. Tagged only on the genuinely bad outcomes below
 *  (degraded / per-file failure), not the routine start/empty-queue/summary-of-a-clean-run lines. */
const JSONL_LOG_LEVEL_ERROR = 50;

/** Tier B's own result shape, before the wrapper merges in Tier C's drain summary (§9d) --
 *  `runTierBBatchCore`/`emptyResult`/`finalizeBatch` only ever know about Tier B's own fields. */
type TierBOnlyResult = Omit<
  TierBBatchResult,
  | "tierCQueued"
  | "tierCProcessed"
  | "tierCPersisted"
  | "tierCDeduped"
  | "tierCFailed"
  | "tierCSkipped"
  | "tierCSkippedReason"
>;

export interface TierBBatchDeps {
  workspaceRoot: string;
  logger: ILogger;
  store: IGraphStore;
  git: IGitProvider;
  knowledgeGit: IKnowledgeGitService;
  providerConfig?: EdgeResolutionProviderConfig;
  commitCap?: number;
  // --- Tier C's §9d "fold into the same pre-push composition" fields (phase1-decision-integration.md §9) ---
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  tierCDailyCallCap?: number;
  tierCDailyTokenCap?: number;
  tierCWallClockMs?: number;
  tierCItemCap?: number;
  tierCLoadThreshold?: number;
  force?: boolean;
  /** `analyze --escalate-to-lsp --full` (typescript-cli-benchmark.md §5.3/§5.7 item 1) --
   *  pre-populates `tierBQueue` with every currently-tracked file before the batch drains it. */
  full?: boolean;
}

/**
 * `analyze --escalate-to-lsp` -- the Tier B batch (phase1-decision-integration.md §8; PLAT-007
 * Tier B), with Tier C's queue drain folded into the same run (§9d). A thin wrapper around
 * `runTierBBatchCore` (Tier B's own logic, unchanged) that also drains `tierCQueue` and merges
 * its summary into the same `TierBBatchResult` -- Tier C never gets its own CLI surface (§9d's
 * "no new command" ruling).
 */
export async function runTierBBatch(
  deps: TierBBatchDeps,
): Promise<TierBBatchResult> {
  const tierBResult = await runTierBBatchCore(deps);
  const tierC = await runTierCDrain({
    workspaceRoot: deps.workspaceRoot,
    logger: deps.logger,
    store: deps.store,
    git: deps.git,
    llmBaseUrl: deps.llmBaseUrl,
    llmApiKey: deps.llmApiKey,
    llmModel: deps.llmModel,
    dailyCallCap: deps.tierCDailyCallCap,
    dailyTokenCap: deps.tierCDailyTokenCap,
    wallClockMs: deps.tierCWallClockMs,
    itemCap: deps.tierCItemCap,
    loadThreshold: deps.tierCLoadThreshold,
    force: deps.force,
  });
  return { ...tierBResult, ...tierC };
}

/**
 * Tier B's own batch logic (D1-D6), unchanged by Slice 4 apart from its name and the one-line
 * §9h queue-size addition in `finalizeBatch`. Drains the whole `tierBQueue` (D6): drops entries
 * whose file no longer exists at HEAD, skips entries whose language has no plugin yet (D4),
 * routes the rest through the D1 edge-resolution provider seam, applies any resolved cross-file
 * `calls` edges plus the incoming-edge repair prune (D3), and stages (never directly writes) the
 * queue drain + commit-cap seed for `SnapshotWorkflow`'s post-pack finalize step to commit (D5/D6:
 * both only take effect after a successful snapshot).
 */
async function runTierBBatchCore(
  deps: TierBBatchDeps,
): Promise<TierBOnlyResult> {
  const { workspaceRoot, logger, store, git, knowledgeGit } = deps;

  logger.info(ANALYZE_MESSAGES.TIER_B_STARTING);
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.TIER_B_START,
  });

  const headSha = (await git.getHeadSha(workspaceRoot)) ?? null;
  const commitCapExceeded = isTierBCommitCapExceeded(store, deps.commitCap);

  if (deps.full) {
    const { filesQueued } = await queueFullTierBResync({
      workspaceRoot,
      store,
      git,
    });
    logger.info(ANALYZE_MESSAGES.TIER_B_FULL_RESYNC_QUEUED(filesQueued));
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_B_FULL_RESYNC_QUEUED,
      filesQueued,
    });
  }

  const queue = readTierBQueue(store);
  if (queue.length === 0) {
    logger.info(ANALYZE_MESSAGES.TIER_B_EMPTY_QUEUE);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_B_EMPTY_QUEUE,
    });
    return emptyResult(headSha, commitCapExceeded);
  }

  const { buckets, toProcess, droppedDeleted, skippedLanguage } =
    await dispatchQueue(deps, queue);
  await logDroppedAndSkipped(workspaceRoot, droppedDeleted, skippedLanguage);

  if (toProcess.length === 0) {
    return await finalizeBatch(deps, {
      headSha,
      commitCapExceeded,
      queued: queue.length,
      droppedDeleted: droppedDeleted.length,
      skippedLanguage: skippedLanguage.length,
      outcome: {
        edges: [],
        filesProcessed: [],
        filesFailed: [],
        degradedLanguages: [],
      },
      failedEntries: [],
      permanentFailed: [],
      edgesApplied: 0,
      edgesPruned: 0,
    });
  }

  const outcome = await resolveEdgesForQueue(deps, buckets);

  for (const failure of outcome.filesFailed) {
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_B_FILE_FAILED,
      level: JSONL_LOG_LEVEL_ERROR,
      file: failure.file,
      reason: failure.reason,
      retryable: failure.retryable,
    });
  }

  if (outcome.unavailableReason) {
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_B_DEGRADED,
      level: JSONL_LOG_LEVEL_ERROR,
      reason: outcome.unavailableReason,
      degradedLanguages: outcome.degradedLanguages,
    });
    logger.info(ANALYZE_MESSAGES.TIER_B_DEGRADED(outcome.unavailableReason));
  }

  // Apply whatever edges were genuinely resolved before the batch stopped -- whether it finished
  // cleanly or ended with `unavailableReason` set after real partial progress (e.g. a whole-batch
  // timeout that completed some files first, lsp-edge-provider-base.ts's `processAllFiles`). A
  // spawn/initialize failure has nothing to apply (`outcome.filesProcessed` is empty in that case,
  // same as before), but a partial timeout no longer discards edges that were already correctly
  // resolved just because the run also ended up `degraded` overall (2026-07 CLI benchmark
  // finding -- see run-tier-b-batch.unit.test.ts's timeout-preserves-partial-progress case).
  const { edgesApplied, edgesPruned } = await applyResolvedEdges(
    deps,
    outcome,
    headSha,
  );
  const processedFiles = new Set(outcome.filesProcessed);
  const retryableByFile = new Map(
    outcome.filesFailed.map((f) => [f.file, f.retryable]),
  );
  const permanentFailed: TierBQueueEntry[] = [];
  const failedEntries = toProcess.filter((e) => {
    if (processedFiles.has(e.file)) return false;
    if (retryableByFile.get(e.file) === false) {
      permanentFailed.push(e);
      return false;
    }
    return true;
  });

  return await finalizeBatch(deps, {
    headSha,
    commitCapExceeded,
    queued: queue.length,
    droppedDeleted: droppedDeleted.length,
    skippedLanguage: skippedLanguage.length,
    outcome,
    failedEntries,
    permanentFailed,
    edgesApplied,
    edgesPruned,
    degradedReason: outcome.unavailableReason,
  });
}

function emptyResult(
  headSha: string | null,
  commitCapExceeded: boolean,
): TierBOnlyResult {
  return {
    kind: AnalyzeResultKind.TIER_B_BATCH,
    headSha,
    filesQueued: 0,
    filesDroppedDeleted: 0,
    filesSkippedLanguage: 0,
    filesProcessed: 0,
    filesFailed: 0,
    filesFailedPermanent: 0,
    edgesApplied: 0,
    edgesPruned: 0,
    degraded: false,
    commitCapExceeded,
  };
}

/** Splits the queue into: entries to attempt, bucketed per language (`buckets`/`toProcess` --
 *  the flattened form of the same buckets, kept for callers that only care about the total),
 *  entries whose file no longer exists at HEAD (`droppedDeleted`, checked against the working
 *  tree -- Tier B reads live files off disk for the LSP session, so "exists at HEAD" is
 *  approximated by "exists in the working tree", a documented assumption), and entries whose
 *  language has no Tier B plugin yet (`skippedLanguage`, D4). */
async function dispatchQueue(
  deps: TierBBatchDeps,
  queue: TierBQueueEntry[],
): Promise<{
  buckets: Partial<Record<TierBLanguageId, TierBQueueEntry[]>>;
  toProcess: TierBQueueEntry[];
  droppedDeleted: TierBQueueEntry[];
  skippedLanguage: TierBQueueEntry[];
}> {
  const { workspaceRoot } = deps;
  const existing: TierBQueueEntry[] = [];
  const droppedDeleted: TierBQueueEntry[] = [];

  for (const entry of queue) {
    if (fs.existsSync(path.join(workspaceRoot, entry.file)))
      existing.push(entry);
    else droppedDeleted.push(entry);
  }

  const { buckets, unsupported } = partitionQueueByLanguage(existing);
  return {
    buckets,
    toProcess: Object.values(buckets).flatMap((entries) => entries ?? []),
    droppedDeleted,
    skippedLanguage: unsupported,
  };
}

async function logDroppedAndSkipped(
  workspaceRoot: string,
  droppedDeleted: TierBQueueEntry[],
  skippedLanguage: TierBQueueEntry[],
): Promise<void> {
  for (const entry of droppedDeleted) {
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_B_FILE_DROPPED_DELETED,
      file: entry.file,
    });
  }
  for (const entry of skippedLanguage) {
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_B_FILE_SKIPPED_LANGUAGE,
      file: entry.file,
    });
  }
}

/** Dispatches each language bucket to its registered provider and merges the outcomes (§8b/§8e;
 *  multi-language-lsp-support plan, Finding A/B/F) -- the per-language dispatch/merge itself lives
 *  in `tier-b-edge-resolution-orchestrator.ts`, this is just the Tier B batch's call site. */
async function resolveEdgesForQueue(
  deps: TierBBatchDeps,
  buckets: Partial<Record<TierBLanguageId, TierBQueueEntry[]>>,
): Promise<MergedEdgeResolutionOutcome> {
  const { workspaceRoot, logger, providerConfig, store, git } = deps;
  return resolveEdgesForLanguageBuckets(buckets, {
    workspaceRoot,
    logger,
    providerConfig,
    store,
    git,
  });
}

/** Applies resolved edges (§8d): both sides resolved via `findNodeIdByNodeKey` at *current* ids
 *  (never invented, never recovered from a stale row) and deduped against the batch's own
 *  pre-existing `node_links` snapshot so a re-run after a crash never double-inserts. Also runs
 *  the incoming-edge repair prune. All under the knowledge-branch lock + store write lock, the
 *  same discipline Tier A's delta persist step uses. Also stamps `project_files`' Tier B tracking
 *  columns (typescript-cli-benchmark.md §5.3/§5.7 item 2) for every file this batch actually
 *  resolved edges for (`outcome.filesProcessed` -- never a failed/timed-out file) -- deliberately
 *  not staged behind `snapshot` (see this file's own D5/D6 doc comments), since the edges
 *  themselves already aren't staged either. */
async function applyResolvedEdges(
  deps: TierBBatchDeps,
  outcome: MergedEdgeResolutionOutcome,
  headSha: string | null,
): Promise<{ edgesApplied: number; edgesPruned: number }> {
  const { store, knowledgeGit, workspaceRoot } = deps;
  let edgesApplied = 0;
  let edgesPruned = 0;

  await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, async () => {
    await store.withWriteLock(() => {
      const existingLinks = new Set(
        store.graph
          .getAllLinks()
          .map(
            (l) => `${l.source_node_id}->${l.target_node_id}->${l.link_type}`,
          ),
      );

      for (const edge of outcome.edges) {
        const sourceId = store.graph.findNodeIdByNodeKey(edge.sourceNodeKey);
        const targetId = store.graph.findNodeIdByNodeKey(edge.targetNodeKey);
        if (sourceId === undefined || targetId === undefined) continue;

        const linkKey = `${sourceId}->${targetId}->${LinkTypes.CALLS}`;
        if (existingLinks.has(linkKey)) continue;
        existingLinks.add(linkKey);

        store.graph.insertLink({
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          linkType: LinkTypes.CALLS,
        });
        edgesApplied++;
      }

      edgesPruned = store.graph.pruneOrphanedLinks();

      const project = store.projects.getFirst();
      if (project) {
        for (const file of outcome.filesProcessed) {
          store.files.markTierBProcessed({
            projectId: project.id,
            filePath: file,
            commitSha: headSha,
          });
        }
      }
    });
  });

  return { edgesApplied, edgesPruned };
}

interface FinalizeArgs {
  headSha: string | null;
  commitCapExceeded: boolean;
  queued: number;
  droppedDeleted: number;
  skippedLanguage: number;
  outcome: MergedEdgeResolutionOutcome;
  failedEntries: TierBQueueEntry[];
  permanentFailed: TierBQueueEntry[];
  edgesApplied: number;
  edgesPruned: number;
  degradedReason?: string;
}

/** Stages the pending-finalize record (D5/D6: queue drain + commit-cap seed only take effect
 *  after `SnapshotWorkflow`'s next successful pack) and writes the summary JSONL line. */
async function finalizeBatch(
  deps: TierBBatchDeps,
  args: FinalizeArgs,
): Promise<TierBOnlyResult> {
  const { workspaceRoot, logger, store, knowledgeGit } = deps;
  const { headSha, outcome, failedEntries, permanentFailed } = args;

  if (headSha && permanentFailed.length > 0) {
    const project = store.projects.getFirst();
    if (project) {
      for (const entry of permanentFailed) {
        store.files.markTierBProcessed({
          projectId: project.id,
          filePath: entry.file,
          commitSha: headSha,
        });
      }
    }
  }

  if (headSha) {
    const pending: PendingTierBBatch = {
      headSha,
      remainingQueue: failedEntries,
    };
    await knowledgeGit.runUnderKnowledgeLock(workspaceRoot, async () => {
      await store.withWriteLock(() => {
        store.meta.set(
          GitConstants.META_KEY_TIER_B_BATCH_PENDING,
          JSON.stringify(pending),
        );
      });
    });
  }

  // Not gated on `outcome.unavailableReason` -- a partial timeout can still have genuinely
  // processed files before it tripped (`processAllFiles`'s deadline handling), and those files'
  // edges were just applied above by `applyResolvedEdges`, so the reported count must match.
  const filesProcessed = outcome.filesProcessed.length;

  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.TIER_B_SUMMARY,
    ...(outcome.unavailableReason ? { level: JSONL_LOG_LEVEL_ERROR } : {}),
    headSha,
    filesQueued: args.queued,
    filesDroppedDeleted: args.droppedDeleted,
    filesSkippedLanguage: args.skippedLanguage,
    filesProcessed,
    filesFailed: failedEntries.length,
    filesFailedPermanent: permanentFailed.length,
    edgesApplied: args.edgesApplied,
    edgesPruned: args.edgesPruned,
    degraded: Boolean(outcome.unavailableReason),
    degradedLanguages: outcome.degradedLanguages,
    commitCapExceeded: args.commitCapExceeded,
  });
  logger.info(
    ANALYZE_MESSAGES.TIER_B_SUMMARY(
      filesProcessed,
      args.edgesApplied,
      permanentFailed.length,
    ),
  );

  return {
    kind: AnalyzeResultKind.TIER_B_BATCH,
    headSha,
    filesQueued: args.queued,
    filesDroppedDeleted: args.droppedDeleted,
    filesSkippedLanguage: args.skippedLanguage,
    filesProcessed,
    filesFailed: failedEntries.length,
    filesFailedPermanent: permanentFailed.length,
    edgesApplied: args.edgesApplied,
    edgesPruned: args.edgesPruned,
    degraded: Boolean(outcome.unavailableReason),
    degradedReason: args.degradedReason,
    degradedLanguages:
      outcome.degradedLanguages.length > 0
        ? outcome.degradedLanguages
        : undefined,
    commitCapExceeded: args.commitCapExceeded,
  };
}
