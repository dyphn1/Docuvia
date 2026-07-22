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
  const { workspaceRoot, logger, store, git } = deps;

  logger.info(ANALYZE_MESSAGES.TIER_B_STARTING);
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.TIER_B_START,
  });

  const headSha = (await git.getHeadSha(workspaceRoot)) ?? null;
  const commitCapExceeded = isTierBCommitCapExceeded(store, deps.commitCap);

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
      edgesApplied: 0,
      edgesPruned: 0,
    });
  }

  const outcome = await resolveEdgesForQueue(deps, buckets);
  if (outcome.unavailableReason) {
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_B_DEGRADED,
      reason: outcome.unavailableReason,
      degradedLanguages: outcome.degradedLanguages,
    });
    logger.info(ANALYZE_MESSAGES.TIER_B_DEGRADED(outcome.unavailableReason));
    return await finalizeBatch(deps, {
      headSha,
      commitCapExceeded,
      queued: queue.length,
      droppedDeleted: droppedDeleted.length,
      skippedLanguage: skippedLanguage.length,
      outcome,
      failedEntries: toProcess,
      edgesApplied: 0,
      edgesPruned: 0,
      degradedReason: outcome.unavailableReason,
    });
  }

  for (const failure of outcome.filesFailed) {
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_B_FILE_FAILED,
      file: failure.file,
      reason: failure.reason,
    });
  }

  const { edgesApplied, edgesPruned } = await applyResolvedEdges(deps, outcome);
  const processedFiles = new Set(outcome.filesProcessed);
  const failedEntries = toProcess.filter((e) => !processedFiles.has(e.file));

  return await finalizeBatch(deps, {
    headSha,
    commitCapExceeded,
    queued: queue.length,
    droppedDeleted: droppedDeleted.length,
    skippedLanguage: skippedLanguage.length,
    outcome,
    failedEntries,
    edgesApplied,
    edgesPruned,
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
  const { workspaceRoot, logger, providerConfig } = deps;
  return resolveEdgesForLanguageBuckets(buckets, {
    workspaceRoot,
    logger,
    providerConfig,
  });
}

/** Applies resolved edges (§8d): both sides resolved via `findNodeIdByNodeKey` at *current* ids
 *  (never invented, never recovered from a stale row) and deduped against the batch's own
 *  pre-existing `node_links` snapshot so a re-run after a crash never double-inserts. Also runs
 *  the incoming-edge repair prune. All under the knowledge-branch lock + store write lock, the
 *  same discipline Tier A's delta persist step uses. */
async function applyResolvedEdges(
  deps: TierBBatchDeps,
  outcome: MergedEdgeResolutionOutcome,
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
  const { headSha, outcome, failedEntries } = args;

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

  const filesProcessed = outcome.unavailableReason
    ? 0
    : outcome.filesProcessed.length;

  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.TIER_B_SUMMARY,
    headSha,
    filesQueued: args.queued,
    filesDroppedDeleted: args.droppedDeleted,
    filesSkippedLanguage: args.skippedLanguage,
    filesProcessed,
    filesFailed: failedEntries.length,
    edgesApplied: args.edgesApplied,
    edgesPruned: args.edgesPruned,
    degraded: Boolean(outcome.unavailableReason),
    degradedLanguages: outcome.degradedLanguages,
    commitCapExceeded: args.commitCapExceeded,
  });
  logger.info(
    ANALYZE_MESSAGES.TIER_B_SUMMARY(filesProcessed, args.edgesApplied),
  );

  return {
    kind: AnalyzeResultKind.TIER_B_BATCH,
    headSha,
    filesQueued: args.queued,
    filesDroppedDeleted: args.droppedDeleted,
    filesSkippedLanguage: args.skippedLanguage,
    filesProcessed,
    filesFailed: failedEntries.length,
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
