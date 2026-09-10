import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  ChatMessageRoles,
  type IGitProvider,
  type IGraphStore,
  type ILogger,
  type ILlmClient,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import {
  ANALYZE_EVENTS,
  ANALYZE_MESSAGES,
  TIER_C_COMMIT_MESSAGE_MAX_LENGTH,
  TIER_C_COMMIT_MESSAGE_SYSTEM_PROMPT,
  TIER_C_COMMIT_MESSAGE_USER_MESSAGE,
  TIER_C_CONTRACT_SYMBOL_SYSTEM_PROMPT,
  TIER_C_CONTRACT_SYMBOL_USER_MESSAGE,
} from "./analyze-messages.js";
import { parseDecisionsFromLlmContent } from "./decision-parsing.js";
import { toNodeKey } from "./anchor-resolution.js";
import type { ExtractedDecision } from "./analyze-result.js";
import {
  TierCCandidateKinds,
  readTierCQueue,
  recordTierCQueueFailure,
  removeTierCQueueEntries,
  type TierCQueueEntry,
} from "./tier-c-queue.js";
import {
  estimateTokenCount,
  isTierCBudgetExhausted,
  readTierCBudget,
  writeTierCBudget,
  type TierCBudget,
} from "./tier-c-budget.js";
import {
  checkTierCSystemLoad,
  tryAcquireTierCLock,
} from "./tier-c-throttle.js";

/** §9f's whole-drain-skip reasons (`skipDrain`'s `reason` param) -- distinct from the
 *  per-item `TierCFailReasons` below (an individual candidate's extraction failure). */
const TierCSkipReasons = {
  LLM_NOT_CONFIGURED: "llm-not-configured",
  LOCK_CONTENDED: "lock-contended",
  BUDGET_EXHAUSTED: "budget-exhausted",
  LOAD_HIGH: "load-high",
} as const;

/** Per-item extraction failure reasons (`failOutcome`'s `reason` param, §9f). */
const TierCFailReasons = {
  NO_ANCHOR: "no-anchor",
  BRIDGE_UNREACHABLE: "bridge-unreachable",
  LLM_NON_JSON_OUTPUT: "llm-non-json-output",
  MISSING_FILE: "missing-file",
  FILE_UNREADABLE: "file-unreadable",
} as const;

export interface TierCDrainDeps {
  workspaceRoot: string;
  logger: ILogger;
  store: IGraphStore;
  git: IGitProvider;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  dailyCallCap?: number;
  dailyTokenCap?: number;
  wallClockMs?: number;
  itemCap?: number;
  /** Retry budget (consecutive per-item failures) before a poison-pill queue entry is evicted --
   *  defaults to `GitConstants.DEFAULT_TIER_C_MAX_ITEM_FAILURES`; threaded through the same way
   *  as `itemCap`/`wallClockMs` so tests can inject a small cap without waiting for real runs. */
  itemFailureCap?: number;
  loadThreshold?: number;
  force?: boolean;
  /** `--tier-c-all` (issue #145): when true, drains every queued item in one run --
   *  removes the wall-clock and item-count caps entirely. Budget exhaustion and
   *  per-item failures (poison-pill eviction) still apply. */
  drainAll?: boolean;
}

export interface TierCDrainSummary {
  tierCQueued: number;
  tierCProcessed: number;
  tierCPersisted: number;
  tierCDeduped: number;
  tierCFailed: number;
  tierCSkipped: boolean;
  tierCSkippedReason?: string;
}

function buildSummary(input: {
  queued: number;
  processed: number;
  persisted: number;
  deduped: number;
  failed: number;
  skipped: boolean;
  reason?: string;
}): TierCDrainSummary {
  return {
    tierCQueued: input.queued,
    tierCProcessed: input.processed,
    tierCPersisted: input.persisted,
    tierCDeduped: input.deduped,
    tierCFailed: input.failed,
    tierCSkipped: input.skipped,
    tierCSkippedReason: input.reason,
  };
}

async function skipDrain(
  deps: TierCDrainDeps,
  queued: number,
  reason: string,
): Promise<TierCDrainSummary> {
  deps.logger.info(ANALYZE_MESSAGES.TIER_C_SKIPPED(reason));
  await appendAnalyzeLogLine(deps.workspaceRoot, {
    event: ANALYZE_EVENTS.TIER_C_SKIPPED,
    reason,
    queued,
  });
  return buildSummary({
    queued,
    processed: 0,
    persisted: 0,
    deduped: 0,
    failed: 0,
    skipped: true,
    reason,
  });
}

async function checkAlreadySnapshotted(
  deps: TierCDrainDeps,
  store: IGraphStore,
  workspaceRoot: string,
): Promise<boolean> {
  let isAlreadySnapshotted = false;
  let headSha: string | null = null;
  try {
    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger: deps.logger,
    });
    headSha = (await deps.git.getHeadSha(workspaceRoot)) ?? null;
    isAlreadySnapshotted = !!(headSha &&
    typeof knowledgeGit.hasSourceCommitInHistory === "function"
      ? await knowledgeGit.hasSourceCommitInHistory(workspaceRoot, headSha)
      : false);
  } catch {
    // Graceful fallback when KnowledgeGitService is not registered (e.g. in thin unit tests)
  }

  if (isAlreadySnapshotted) {
    const hasTierCDecisions = store.l3
      .getAllExportable()
      .some((row) => row.commit_hash === headSha);
    if (hasTierCDecisions && !deps.force) {
      return true;
    }
  }
  return false;
}

/**
 * Tier C drain entry point (phase1-decision-integration.md section 9), folded into the same
 * analyze --escalate-to-lsp composition Tier B drains from (section 9d, "no new command").
 * Order of checks, all honest-degradation gates (section 9f) -- any one failing skips the whole
 * drain this run (leftover items stay queued untouched), logged, never a hard failure:
 *   1. Empty queue -> no-op (cheap, the common case).
 *   2. LLM bridge not configured (llmBaseUrl/llmModel missing) -> skip.
 *   3. Concurrency=1 lock contended -> skip.
 *   4. Daily call/token budget already exhausted (lazy UTC reset applied on read) -> skip.
 *   5. System-load check trips (a documented no-op on Windows) -> skip.
 * Otherwise drains item-by-item under a wall-clock cap and an item-count cap, whichever binds
 * first; each item is dequeued only once its extraction is durably persisted (per-item
 * stage-then-finalize, mirroring Tier B's "cleared only after successful effect" discipline).
 */
export async function runTierCDrain(
  deps: TierCDrainDeps,
): Promise<TierCDrainSummary> {
  const { workspaceRoot, store } = deps;
  const queue = readTierCQueue(store);

  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.TIER_C_START,
    queued: queue.length,
  });

  if (queue.length === 0) {
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_C_EMPTY_QUEUE,
    });
    return buildSummary({
      queued: 0,
      processed: 0,
      persisted: 0,
      deduped: 0,
      failed: 0,
      skipped: false,
    });
  }

  const isSnapshotted = await checkAlreadySnapshotted(
    deps,
    store,
    workspaceRoot,
  );
  if (isSnapshotted) {
    return await skipDrain(
      deps,
      queue.length,
      "already-snapshotted-with-tier-c",
    );
  }

  if (!deps.llmBaseUrl || !deps.llmModel) {
    return await skipDrain(
      deps,
      queue.length,
      TierCSkipReasons.LLM_NOT_CONFIGURED,
    );
  }

  const lock = await tryAcquireTierCLock(workspaceRoot);
  if (!lock)
    return await skipDrain(deps, queue.length, TierCSkipReasons.LOCK_CONTENDED);

  try {
    return await runGatedDrain(deps, queue);
  } finally {
    await lock.release();
  }
}

/** The two remaining section 9f throttling gates that only apply once the lock is held: daily
 *  budget, then system load. Split out of runTierCDrain to keep its own cyclomatic complexity
 *  low. */
async function runGatedDrain(
  deps: TierCDrainDeps,
  queue: TierCQueueEntry[],
): Promise<TierCDrainSummary> {
  const { workspaceRoot, store } = deps;
  const dailyCallCap =
    deps.dailyCallCap ?? GitConstants.DEFAULT_TIER_C_DAILY_CALL_CAP;
  const dailyTokenCap =
    deps.dailyTokenCap ?? GitConstants.DEFAULT_TIER_C_DAILY_TOKEN_CAP;

  const budget = readTierCBudget(store);
  if (isTierCBudgetExhausted(budget, dailyCallCap, dailyTokenCap)) {
    return await skipDrain(
      deps,
      queue.length,
      TierCSkipReasons.BUDGET_EXHAUSTED,
    );
  }

  const loadCheck = checkTierCSystemLoad(deps.loadThreshold);
  if (loadCheck.note) {
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_C_LOAD_NOTE,
      note: loadCheck.note,
    });
  }
  if (!loadCheck.ok) {
    return await skipDrain(deps, queue.length, TierCSkipReasons.LOAD_HIGH);
  }

  return await drainQueue(deps, queue, budget, dailyCallCap, dailyTokenCap);
}

interface TierCItemOutcome {
  success: boolean;
  reason?: string;
  persistedCount: number;
  dedupedCount: number;
  tokensUsed: number;
  callsUsed: number;
}

function failOutcome(reason: string): TierCItemOutcome {
  return {
    success: false,
    reason,
    persistedCount: 0,
    dedupedCount: 0,
    tokensUsed: 0,
    callsUsed: 0,
  };
}

/** Resolves the wall-clock and item-count caps for the drain loop, honoring `drainAll`
 *  (issue #145): when true, both caps become +Infinity so the loop drains every item. */
function resolveDrainCaps(deps: TierCDrainDeps): {
  wallClockMs: number;
  itemCap: number;
} {
  if (deps.drainAll) {
    return {
      wallClockMs: Number.POSITIVE_INFINITY,
      itemCap: Number.POSITIVE_INFINITY,
    };
  }
  return {
    wallClockMs: deps.wallClockMs ?? GitConstants.DEFAULT_TIER_C_WALL_CLOCK_MS,
    itemCap: deps.itemCap ?? GitConstants.DEFAULT_TIER_C_ITEM_CAP,
  };
}

/** The item-by-item drain loop: wall-clock cap and item cap (whichever binds first, section 9d),
 *  a budget re-check before every item (mid-run exhaustion stops the loop with a JSONL line,
 *  section 9k gating test 2), and one dequeue-on-success per item (crash-safety: a killed process
 *  leaves already-persisted items dequeued and the rest still queued, no separate staging record
 *  needed). */
async function drainQueue(
  deps: TierCDrainDeps,
  queue: TierCQueueEntry[],
  initialBudget: TierCBudget,
  dailyCallCap: number,
  dailyTokenCap: number,
): Promise<TierCDrainSummary> {
  const { store, workspaceRoot, logger } = deps;
  const { wallClockMs, itemCap } = resolveDrainCaps(deps);
  const deadline = Date.now() + wallClockMs;

  const buildLlmClient = docuviaFactory.resolve(TOKENS.LlmClient);
  const llmClient = buildLlmClient();
  llmClient.initialize({ baseUrl: deps.llmBaseUrl!, apiKey: deps.llmApiKey });

  let budget = initialBudget;
  const counters = { processed: 0, persisted: 0, deduped: 0, failed: 0 };

  for (const entry of queue) {
    if (counters.processed + counters.failed >= itemCap) break;
    if (Date.now() >= deadline) break;
    if (isTierCBudgetExhausted(budget, dailyCallCap, dailyTokenCap)) {
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.TIER_C_SKIPPED,
        reason: TierCSkipReasons.BUDGET_EXHAUSTED,
        queued: queue.length,
        midRun: true,
      });
      break;
    }

    const outcome = await processTierCEntry(deps, llmClient, entry);
    budget = await updateTierCBudgetIfUsed(store, budget, outcome);

    const shouldBreak = await handleTierCItemOutcome(
      deps,
      entry,
      outcome,
      counters,
    );
    if (shouldBreak) break;
  }

  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.TIER_C_SUMMARY,
    queued: queue.length,
    ...counters,
  });
  logger.info(
    ANALYZE_MESSAGES.TIER_C_SUMMARY(counters.processed, counters.persisted),
  );

  if (counters.processed > 0) {
    await store.withWriteLock(() => {
      store.meta.set("tierCProcessedThisRun", "true");
    });
  }

  return buildSummary({
    queued: queue.length,
    ...counters,
    skipped: false,
  });
}

/** Applies `outcome`'s LLM usage (if any) to `budget`, persisting the updated budget under the
 *  store's write lock -- split out of `drainQueue`'s loop body to keep its own complexity low. */
async function updateTierCBudgetIfUsed(
  store: IGraphStore,
  budget: TierCBudget,
  outcome: TierCItemOutcome,
): Promise<TierCBudget> {
  if (outcome.callsUsed === 0 && outcome.tokensUsed === 0) return budget;

  const updated: TierCBudget = {
    date: budget.date,
    calls: budget.calls + outcome.callsUsed,
    tokens: budget.tokens + outcome.tokensUsed,
  };
  await store.withWriteLock(() => writeTierCBudget(store, updated));
  return updated;
}

/** Applies `outcome` to the running `counters` (mutated in place) -- dequeues the entry and logs
 *  success, or logs failure and reports whether the loop should stop entirely (a bridge-
 *  unreachable failure, §9d). Split out of `drainQueue`'s loop body to keep its own complexity
 *  low. */
async function handleTierCItemOutcome(
  deps: TierCDrainDeps,
  entry: TierCQueueEntry,
  outcome: TierCItemOutcome,
  counters: {
    processed: number;
    persisted: number;
    deduped: number;
    failed: number;
  },
): Promise<boolean> {
  const { store, workspaceRoot } = deps;

  if (outcome.success) {
    counters.processed++;
    counters.persisted += outcome.persistedCount;
    counters.deduped += outcome.dedupedCount;
    await store.withWriteLock(() =>
      removeTierCQueueEntries(store, [entry.target]),
    );
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_C_ITEM_SUCCESS,
      kind: entry.kind,
      target: entry.target,
      persisted: outcome.persistedCount,
      deduped: outcome.dedupedCount,
    });
    return false;
  }

  counters.failed++;
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.TIER_C_ITEM_FAILED,
    kind: entry.kind,
    target: entry.target,
    reason: outcome.reason,
  });

  const itemFailureCap =
    deps.itemFailureCap ?? GitConstants.DEFAULT_TIER_C_MAX_ITEM_FAILURES;
  const { evicted, failCount } = await store.withWriteLock(() =>
    recordTierCQueueFailure(store, entry.target, itemFailureCap),
  );
  if (evicted) {
    deps.logger.warn(
      ANALYZE_MESSAGES.TIER_C_ITEM_EVICTED(entry.kind, entry.target, failCount),
    );
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.TIER_C_ITEM_EVICTED,
      kind: entry.kind,
      target: entry.target,
      failCount,
      reason: outcome.reason,
    });
  }

  // FIX (issue #145): Skip to next item instead of stopping the entire drain loop.
  // The poison-pill mechanism (eviction after N failures) still applies per item,
  // but a single bridge-unreachable failure no longer blocks all subsequent items.
  return false;
}

function isBridgeUnreachable(err: unknown): boolean {
  return (
    err instanceof DocuviaError &&
    err.code === ErrorCodes.LLM_CHAT_COMPLETION_FAILED
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Basic sanitization of an attacker-controllable commit message before it reaches the Tier C
 *  LLM (issue #111): strips control characters (ANSI/terminal escape sequences and friends, but
 *  keeping `\n`/`\t`/`\r` for body formatting) and truncates to
 *  `TIER_C_COMMIT_MESSAGE_MAX_LENGTH` so a single hostile message can't monopolize the prompt
 *  window / Tier C budget. The prompt-side defense (system prompt + untrusted-data delimiter)
 *  lives in `analyze-messages.ts`. */
function sanitizeCommitMessage(message: string): string {
  const stripped = message.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    "",
  );
  return stripped.slice(0, TIER_C_COMMIT_MESSAGE_MAX_LENGTH);
}

async function callTierCLlm(
  llmClient: ILlmClient,
  model: string,
  systemPrompt: string,
  userMessage: string,
): Promise<{ decisions: ExtractedDecision[] | undefined; tokensUsed: number }> {
  const response = await llmClient.chatCompletion({
    model,
    temperature: 0.2,
    messages: [
      { role: ChatMessageRoles.SYSTEM, content: systemPrompt },
      { role: ChatMessageRoles.USER, content: userMessage },
    ],
  });
  const rawContent = response.choices[0]?.message.content;
  const decisions = parseDecisionsFromLlmContent(rawContent);
  const tokensUsed = estimateTokenCount(
    systemPrompt + userMessage + (rawContent ?? ""),
  );
  return { decisions, tokensUsed };
}

/** First changed-file (in git.getFilesChangedByCommit order) that already has an L2 node --
 *  mirrors anchor-resolution.ts's directory-target fallback (section 3b), applied to a commit's
 *  file list instead of a directory's collected files. */
function resolveAnchorForFiles(
  store: IGraphStore,
  files: string[],
): number | undefined {
  for (const file of files) {
    const match = store.graph.findNodeIdByNodeKey(toNodeKey(file));
    if (match !== undefined) return match;
  }
  return undefined;
}

/** Writes decisions through IL3NodesRepo.upsertDecision (Slice 1's content-hash upsert path,
 *  phase1-decision-integration.md section 3c) with full provenance -- no machine-local identity
 *  (section 9j): repo-relative sourceFiles, commitSha in source_commits, the existing
 *  content-hash dedup. */
function persistTierCDecisions(
  deps: TierCDrainDeps,
  anchorL2NodeId: number,
  sourceFiles: string[],
  commitSha: string,
  decisions: ExtractedDecision[],
): { persisted: number; deduped: number } {
  const { store, llmModel } = deps;
  const project = store.projects.getFirst();
  if (!project) return { persisted: 0, deduped: 0 };

  const normalizedSourceFiles = sourceFiles.map(toNodeKey);
  let persisted = 0;
  let deduped = 0;
  for (const decision of decisions) {
    const result = store.l3.upsertDecision({
      projectId: project.id,
      l2NodeId: anchorL2NodeId,
      title: decision.title,
      content: decision.content,
      nodeType: decision.nodeType,
      confidence: decision.confidence,
      commitSha,
      extractionModel: llmModel ?? null,
      sourceFiles: normalizedSourceFiles,
    });
    if (result.deduped) deduped++;
    else persisted++;
  }
  return { persisted, deduped };
}

async function processTierCEntry(
  deps: TierCDrainDeps,
  llmClient: ILlmClient,
  entry: TierCQueueEntry,
): Promise<TierCItemOutcome> {
  if (entry.kind === TierCCandidateKinds.COMMIT_MESSAGE) {
    return processCommitMessageEntry(deps, llmClient, entry);
  }
  return processContractSymbolEntry(deps, llmClient, entry);
}

async function processCommitMessageEntry(
  deps: TierCDrainDeps,
  llmClient: ILlmClient,
  entry: TierCQueueEntry,
): Promise<TierCItemOutcome> {
  const { git, workspaceRoot, store, llmModel } = deps;

  const changedFiles = await git.getFilesChangedByCommit(
    workspaceRoot,
    entry.commitSha,
  );
  const anchor = resolveAnchorForFiles(store, changedFiles);
  if (anchor === undefined) return failOutcome(TierCFailReasons.NO_ANCHOR);

  let callResult: Awaited<ReturnType<typeof callTierCLlm>>;
  try {
    callResult = await callTierCLlm(
      llmClient,
      llmModel!,
      TIER_C_COMMIT_MESSAGE_SYSTEM_PROMPT,
      TIER_C_COMMIT_MESSAGE_USER_MESSAGE(
        sanitizeCommitMessage(entry.message ?? ""),
      ),
    );
  } catch (err) {
    return {
      ...failOutcome(
        isBridgeUnreachable(err)
          ? TierCFailReasons.BRIDGE_UNREACHABLE
          : errMessage(err),
      ),
      callsUsed: 1,
    };
  }

  if (callResult.decisions === undefined) {
    return {
      ...failOutcome(TierCFailReasons.LLM_NON_JSON_OUTPUT),
      tokensUsed: callResult.tokensUsed,
      callsUsed: 1,
    };
  }

  const { persisted, deduped } = persistTierCDecisions(
    deps,
    anchor,
    changedFiles,
    entry.commitSha,
    callResult.decisions,
  );
  return {
    success: true,
    persistedCount: persisted,
    dedupedCount: deduped,
    tokensUsed: callResult.tokensUsed,
    callsUsed: 1,
  };
}

async function processContractSymbolEntry(
  deps: TierCDrainDeps,
  llmClient: ILlmClient,
  entry: TierCQueueEntry,
): Promise<TierCItemOutcome> {
  const { git, workspaceRoot, store, llmModel } = deps;
  const file = entry.file;
  if (!file) return failOutcome(TierCFailReasons.MISSING_FILE);

  const anchor =
    store.graph.findNodeIdByNodeKey(entry.target) ??
    store.graph.findNodeIdByNodeKey(toNodeKey(file));
  if (anchor === undefined) return failOutcome(TierCFailReasons.NO_ANCHOR);

  const content = await git.readFileAtRef(
    workspaceRoot,
    GitConstants.HEAD_REF,
    file,
  );
  if (content === undefined)
    return failOutcome(TierCFailReasons.FILE_UNREADABLE);

  const symbolName = entry.target.slice(entry.target.indexOf("#") + 1);
  const userMessage = TIER_C_CONTRACT_SYMBOL_USER_MESSAGE(
    symbolName,
    file,
    content,
  );

  let callResult: Awaited<ReturnType<typeof callTierCLlm>>;
  try {
    callResult = await callTierCLlm(
      llmClient,
      llmModel!,
      TIER_C_CONTRACT_SYMBOL_SYSTEM_PROMPT,
      userMessage,
    );
  } catch (err) {
    return {
      ...failOutcome(
        isBridgeUnreachable(err)
          ? TierCFailReasons.BRIDGE_UNREACHABLE
          : errMessage(err),
      ),
      callsUsed: 1,
    };
  }

  if (callResult.decisions === undefined) {
    return {
      ...failOutcome(TierCFailReasons.LLM_NON_JSON_OUTPUT),
      tokensUsed: callResult.tokensUsed,
      callsUsed: 1,
    };
  }

  const { persisted, deduped } = persistTierCDecisions(
    deps,
    anchor,
    [file],
    entry.commitSha,
    callResult.decisions,
  );
  return {
    success: true,
    persistedCount: persisted,
    dedupedCount: deduped,
    tokensUsed: callResult.tokensUsed,
    callsUsed: 1,
  };
}
