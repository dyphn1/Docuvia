import fs from "fs";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  ChatMessageRoles,
  L3DecisionSources,
  type IGitProvider,
  type IGraphStore,
  type IKnowledgeGitService,
  type ILogger,
  type EdgeResolutionProviderConfig,
} from "@workspace/contracts";
import { GitConstants, parseSourceTrailer } from "@workspace/contracts";
import {
  ANALYZE_EVENTS,
  ANALYZE_MESSAGES,
  DECISION_EXTRACTION_SYSTEM_PROMPT,
} from "./analyze-messages.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import {
  collectSourceFiles,
  type CollectedFile,
} from "./decision-extraction.js";
import {
  AnalyzeResultKind,
  type AnalyzeResult,
  type ExtractedDecision,
} from "./analyze-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { seedProjectRow } from "../init/seed-project-row.js";
import { runFullIngestion } from "./run-full-ingestion.js";
import { runDeltaIngestion } from "./run-delta-ingestion.js";
import { runTierBBatch, type TierBBatchDeps } from "./run-tier-b-batch.js";
import { isTierBCommitCapExceeded } from "./tier-b-commit-cap.js";
import {
  parseDecisionsFromLlmContent,
  stripMarkdownCodeFence,
} from "./decision-parsing.js";
import { persistDecisions } from "./persist-l3-decisions.js";
import { runAgentAuthoredWrite } from "./run-agent-authored-write.js";
import { runFlushStagedL3 } from "./run-flush-staged-l3.js";

// Re-exported for the existing `stripMarkdownCodeFence()` test suite in
// `analyze-workflow.unit.test.ts` -- the implementation itself now lives in
// `decision-parsing.js`, shared with Tier C's extraction calls (`run-tier-c-drain.ts`).
export { stripMarkdownCodeFence };

/**
 * The `analyze` workflow — either a project-wide config scan (old Docuvia's
 * `AnalyzeService.analyzeProject`) or, when `options.targetPath` is set, a focused LLM
 * decision-extraction pass over a specific file/directory (old Docuvia's `ExtractService`,
 * formerly the standalone `extract` command). See `AnalyzeResult`'s discriminated union.
 */
export class AnalyzeWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
    private readonly options?: {
      targetPath?: string;
      /** `analyze <targetPath> --agent-authored` (issue #42, roadmap items 32-34) -- when set,
       *  `execute()` skips the LLM-extraction path entirely and persists these decisions
       *  verbatim with `source: L3DecisionSources.AGENT_AUTHORED`. Checked *before* `targetPath`
       *  in `execute()`'s dispatch, since both are set together for this mode. */
      agentAuthoredDecisions?: ExtractedDecision[];
      llmBaseUrl?: string;
      llmApiKey?: string;
      llmModel?: string;
      /** `analyze --escalate-to-lsp` (PLAT-007 Tier B; phase1-decision-integration.md §8) -- a
       *  sibling mode to auto mode / focused extraction, mutually exclusive with `targetPath`. */
      escalateToLsp?: boolean;
      lspProviderConfig?: EdgeResolutionProviderConfig;
      tierBCommitCap?: number;
      /** `analyze --escalate-to-lsp --full` (typescript-cli-benchmark.md §5.3/§5.7 item 1) --
       *  pre-populates `tierBQueue` with every currently-tracked file before the batch drains it.
       *  Ignored outside `escalateToLsp`. */
      full?: boolean;
      force?: boolean;
      /** Tier C's §9f throttling overrides -- folded into the same `--escalate-to-lsp` run
       *  (phase1-decision-integration.md §9d). `llmBaseUrl`/`llmApiKey`/`llmModel` above double as
       *  Tier C's LLM config when `escalateToLsp` is set; a missing `llmBaseUrl`/`llmModel` in
       *  that mode degrades honestly (Tier C drain skipped, LSP escalation still runs) rather than
       *  the hard failure `targetPath` mode uses. */
      tierCDailyCallCap?: number;
      tierCDailyTokenCap?: number;
      tierCWallClockMs?: number;
      tierCItemCap?: number;
      tierCLoadThreshold?: number;
      /** `--tier-c-all` (issue #145): drains every queued Tier C item in one run. */
      tierCDrainAll?: boolean;
      /** `analyze --flush-staged-l3` (issue #42, Decision 2's two-stage stage-and-flush design
       *  §8.2) -- the post-commit hook's drain of `.docuvia/pending-l3-decisions.json`. Sets none
       *  of `targetPath`/`agentAuthoredDecisions`/`escalateToLsp`, so it's checked first in
       *  `execute()`'s dispatch: the most specific/least ambiguous mode, no risk of colliding
       *  with any of the others' own dispatch conditions. */
      flushStagedL3?: boolean;
    },
  ) {}

  public async execute(): Promise<AnalyzeResult> {
    // Checked first -- sets none of targetPath/agentAuthoredDecisions/escalateToLsp, so there's
    // no ambiguity with the branches below (see the option's own doc comment above).
    if (this.options?.flushStagedL3) {
      return runFlushStagedL3({
        workspaceRoot: this.workspaceRoot,
        logger: this.logger,
      });
    }
    // Checked before `targetPath` -- `--agent-authored` mode sets both together (see
    // `agentAuthoredDecisions`'s doc comment above), and the agent-authored write path must win
    // over the LLM-extraction path in that case.
    if (this.options?.agentAuthoredDecisions) {
      return runAgentAuthoredWrite({
        workspaceRoot: this.workspaceRoot,
        logger: this.logger,
        targetPath: this.options.targetPath!,
        decisions: this.options.agentAuthoredDecisions,
      });
    }
    if (this.options?.targetPath) {
      return this.executeDecisionExtraction(this.options.targetPath);
    }
    if (this.options?.escalateToLsp) {
      return this.executeTierBBatch();
    }
    return this.executeAutoMode();
  }

  /** `analyze --escalate-to-lsp`'s envelope: open the store, run the Tier B batch (§8), log a
   *  run-level failure the same way `executeAutoMode` does, always close the store. Mirrors
   *  `executeAutoMode`'s open/error/close shape exactly -- see its doc comment for why the store
   *  open happens inside the try. */
  private async executeTierBBatch(): Promise<AnalyzeResult> {
    const { workspaceRoot, logger, options } = this;
    let store: IGraphStore | undefined;

    try {
      const git = docuviaFactory.resolve(TOKENS.GitProvider);
      const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
        logger,
      });
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
      store = await openStore({
        dbPath: resolveDbPath(workspaceRoot),
        readonly: false,
      });

      return await runTierBBatch(
        buildTierBBatchDeps(
          workspaceRoot,
          logger,
          store,
          git,
          knowledgeGit,
          options,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.TIER_B_ERROR,
        message,
      });
      throw err;
    } finally {
      await store?.close();
    }
  }

  /**
   * No-arg `analyze` — auto mode (PLAT-007 Tier A; phase1-decision-integration.md §6). Order of
   * checks, all against one store open/close:
   *   1. Sha fast-path (§6a, "must be the first check"): `HEAD === lastIngestedSourceSha` -> noop
   *      (2026-07-24 benchmark follow-up: also checks `hasUncommittedChanges` purely to pick the
   *      noop message/log line -- a dirty working tree never changes this being a noop).
   *   2. Empty-graph check (no project row or no L2 nodes) -> full ingestion.
   *   3. Otherwise delta: resolve the baseline sha (`lastIngestedSourceSha`, falling back to the
   *      newest `Docuvia-Source` trailer on the knowledge branch for pre-Slice-2 workspaces, else
   *      a one-time full re-ingest) and diff it to `HEAD`.
   */
  private async executeAutoMode(): Promise<AnalyzeResult> {
    const { workspaceRoot, logger } = this;

    logger.info(ANALYZE_MESSAGES.AUTO_ANALYZING);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.AUTO_START,
    });

    // Declared outside the try so the finally can close it, but resolved/opened INSIDE the try:
    // a store-open/migration failure (DB_OPEN_FAILED — corrupted local.db, disk full) is exactly
    // the kind of realistic background-hook failure the `analyze.auto.error` line below must
    // capture, not silently rethrow past.
    let store: IGraphStore | undefined;

    try {
      const git = docuviaFactory.resolve(TOKENS.GitProvider);
      const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
        logger,
      });
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);

      // Known caveat (Slice 1 verification): opening the store with `readonly: false` on a
      // never-`init`'d workspace silently creates an empty migrated DB rather than throwing
      // `DB_OPEN_FAILED` — the empty-graph precondition below must be (and is) detected via the
      // missing-project-row/L2-count check, not a caught `DB_OPEN_FAILED`.
      store = await openStore({
        dbPath: resolveDbPath(workspaceRoot),
        readonly: false,
      });

      return await this.dispatchAutoMode(store, git, knowledgeGit);
    } catch (err) {
      // Run-level failure JSONL (phase1-decision-integration.md §6c dispatch-2b follow-up): a
      // crashing auto-mode run previously left only `process.exitCode` + stderr behind, which is
      // an invisible failure once the post-commit hook fires it in the background (no developer
      // watching stderr). Mirrors `executeDecisionExtraction`'s `analyze.focused.error` shape —
      // one event covering the whole auto-mode dispatch (store open/migration, fast-path check,
      // empty-graph check, and both `runFullIngestion`/`runDeltaIngestion`), since a failure can
      // occur before the mode is even determined.
      const message = err instanceof Error ? err.message : String(err);
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.AUTO_ERROR,
        message,
      });
      throw err;
    } finally {
      await store?.close();
    }
  }

  /** The fast-path/full/delta decision tree behind `executeAutoMode`'s error/close envelope. */
  private async dispatchAutoMode(
    store: IGraphStore,
    git: IGitProvider,
    knowledgeGit: IKnowledgeGitService,
  ): Promise<AnalyzeResult> {
    const { workspaceRoot, logger } = this;

    const headSha = await git.getHeadSha(workspaceRoot);
    const lastIngestedSha = store.meta.get(
      GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
    );

    // §10c's commit-time nudge — checked once, uniformly across the fast-path/full/delta
    // branches below, before any of them run.
    await this.maybeLogTierBCommitCapNudge(store);

    // 1. Sha fast-path — first check, regardless of graph state. Deliberately HEAD-sha-based
    // (§6a), not filesystem-watch-based, so it cannot see uncommitted edits by design (PLAT-007's
    // "Rejected alternatives"). The 2026-07-24 C# benchmark found the resulting silence was a UX
    // gap for a human running `analyze` interactively -- `hasUncommittedChanges` below only picks
    // the message/log line, it never changes the noop outcome itself.
    if (headSha && lastIngestedSha && headSha === lastIngestedSha) {
      const dirtyWorktree = await git.hasUncommittedChanges(workspaceRoot);
      logger.info(
        dirtyWorktree
          ? ANALYZE_MESSAGES.AUTO_NOOP_DIRTY_WORKTREE
          : ANALYZE_MESSAGES.AUTO_NOOP,
      );
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.DELTA_NOOP,
        headSha,
        dirtyWorktree,
      });
      return {
        kind: AnalyzeResultKind.AUTO_DELTA_NOOP,
        headSha,
        dirtyWorktree,
      };
    }

    // 2. Empty-graph check -> hydrate-then-delta (roadmap item #11) when the knowledge branch
    // already has a hydratable snapshot paired with a stamped source sha, else the original full
    // re-parse of HEAD.
    const project = store.projects.getFirst();
    const { l2Nodes } = store.graph.count();
    if (!project || l2Nodes === 0) {
      return await this.dispatchEmptyGraph(store, git, knowledgeGit, headSha);
    }

    // Non-empty graph but nothing to diff against (unborn/headless HEAD, no commits yet) —
    // an extremely unlikely combination (the graph would ordinarily only be populated via a
    // full ingestion or git hydration, both of which need at least one commit), but treated as
    // a harmless no-op rather than crashing on a `git diff` against a ref that doesn't exist.
    if (!headSha) {
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.DELTA_NO_HEAD,
      });
      return {
        kind: AnalyzeResultKind.AUTO_DELTA_NOOP,
        headSha: null,
        dirtyWorktree: false,
      };
    }

    // 3. Delta — resolve the baseline sha.
    let fromSha = lastIngestedSha;
    if (!fromSha) {
      fromSha = await knowledgeGit.resolveNewestSourceTrailerSha(workspaceRoot);
    }
    if (!fromSha) {
      // Neither the meta key nor a stamped knowledge-branch commit exists — a pre-Slice-2
      // workspace whose knowledge branch (if any) predates the `Docuvia-Source` trailer, or one
      // that never ran `init`'s ingestion at all despite having L2 nodes some other way. One-time
      // full re-ingest, per §6a's fallback order.
      return await runFullIngestion({ workspaceRoot, logger, store, git });
    }

    return await runDeltaIngestion({
      workspaceRoot,
      logger,
      store,
      git,
      knowledgeGit,
      projectId: project.id,
      fromSha,
      headSha,
    });
  }

  /**
   * Step 2 of `dispatchAutoMode`'s decision tree (the empty-graph branch) -- split out purely to
   * keep that method's cyclomatic complexity under the project's ESLint budget (roadmap item
   * #11's hydrate-then-delta branch pushed it over the limit; mirrors `buildTierBBatchDeps`'s
   * precedent for the same reason). `headSha` is required for both `tryHydrateThenDelta`'s
   * pairing lookup and the delta ingestion itself, so it's skipped outright on an unborn/headless
   * HEAD (falls straight through to `runFullIngestion`, matching that state's pre-existing
   * behavior exactly).
   */
  private async dispatchEmptyGraph(
    store: IGraphStore,
    git: IGitProvider,
    knowledgeGit: IKnowledgeGitService,
    headSha: string | undefined,
  ): Promise<AnalyzeResult> {
    const { workspaceRoot, logger } = this;

    const hydrateThenDeltaResult = headSha
      ? await this.tryHydrateThenDelta(store, git, knowledgeGit, headSha)
      : undefined;
    if (hydrateThenDeltaResult) return hydrateThenDeltaResult;
    return await runFullIngestion({ workspaceRoot, logger, store, git });
  }

  /**
   * Roadmap item #11's hydrate-then-delta optimization: an empty `local.db` next to a knowledge
   * branch that already has data would otherwise trigger a full re-parse of HEAD
   * (`runFullIngestion`) even though the knowledge branch's own snapshot can be bulk-loaded
   * instead (`HydrationService.hydrate()` -- cheap, no re-parse) and then delta-ingested up to
   * HEAD. Resolves both halves of the pairing (the hydration commit *and* its stamped
   * `Docuvia-Source` sha) before touching `store` at all, so a resolution failure falls straight
   * through to `runFullIngestion`'s untouched, pre-existing behavior -- returns `undefined` in
   * that case (nothing hydratable yet, or the resolved commit carries no trailer to pair it
   * with).
   */
  private async tryHydrateThenDelta(
    store: IGraphStore,
    git: IGitProvider,
    knowledgeGit: IKnowledgeGitService,
    headSha: string,
  ): Promise<AnalyzeResult | undefined> {
    const { workspaceRoot, logger } = this;

    const hydrationService = docuviaFactory.resolve(TOKENS.HydrationService, {
      logger,
    });
    const knowledgeSha =
      await hydrationService.resolveHydrationCommit(workspaceRoot);
    if (!knowledgeSha) return undefined;

    const fromSha = await resolveSourceShaForKnowledgeCommit(
      git,
      workspaceRoot,
      knowledgeSha,
    );
    if (!fromSha) return undefined;

    const hydrateResult = await hydrationService.hydrate(workspaceRoot, store);
    if (!hydrateResult.hydrated) return undefined;

    const project = await seedProjectRow(store.projects, git, workspaceRoot);

    return await runDeltaIngestion({
      workspaceRoot,
      logger,
      store,
      git,
      knowledgeGit,
      projectId: project.id,
      fromSha,
      headSha,
    });
  }

  /**
   * §10c's commit-time half of the commit-cap trigger (`doctor`'s passive backup is T4, §10c's
   * other half): a non-blocking, one-line nudge once `isTierBCommitCapExceeded` computes true —
   * fires at the moment the user could act on it (mid-workflow, could push now). Never affects
   * `dispatchAutoMode`'s return value/control flow; best-effort (a meta-store read failure here
   * degrades to a skipped nudge, never a crashed `analyze` run). No git call needed since §9m item
   * 1 moved the cap's metric to a store-persisted cumulative-bytes counter.
   */
  private async maybeLogTierBCommitCapNudge(store: IGraphStore): Promise<void> {
    const { workspaceRoot, logger } = this;
    try {
      const exceeded = isTierBCommitCapExceeded(store);
      if (!exceeded) return;

      logger.info(ANALYZE_MESSAGES.TIER_B_CAP_NUDGE);
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.TIER_B_COMMIT_CAP_NUDGE,
      });
    } catch {
      // Best-effort — the nudge is advisory only; a meta-store read failure here must never crash
      // the run.
    }
  }

  private async executeDecisionExtraction(
    targetPath: string,
  ): Promise<AnalyzeResult> {
    const { workspaceRoot, logger, options } = this;

    logger.info(ANALYZE_MESSAGES.EXTRACTING(targetPath));
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FOCUSED_START,
      targetPath,
    });

    const resolvedPath = path.resolve(workspaceRoot, targetPath);
    if (!fs.existsSync(resolvedPath)) {
      const message = ANALYZE_MESSAGES.PATH_NOT_FOUND(targetPath);
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_ERROR,
        targetPath,
        message,
      });
      throw new DocuviaError(ErrorCodes.FS_READ_FAILED, message);
    }

    const { files, droppedFiles } = collectSourceFiles(
      resolvedPath,
      workspaceRoot,
      logger,
    );
    if (droppedFiles.length > 0) {
      logger.warn(ANALYZE_MESSAGES.FILES_DROPPED(droppedFiles.length), {
        droppedFiles,
        targetPath,
      });
    }

    if (files.length === 0) {
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_SUMMARY,
        targetPath,
        decisionsCount: 0,
      });
      return {
        kind: AnalyzeResultKind.DECISION_EXTRACTION,
        targetPath,
        decisions: [],
        persisted: 0,
        deduped: 0,
      };
    }

    const userMessage = files
      .map((f) => `--- ${f.relativePath} ---\n${f.content}`)
      .join("\n\n");

    const buildLlmClient = docuviaFactory.resolve(TOKENS.LlmClient);
    const llmClient = buildLlmClient();
    llmClient.initialize({
      baseUrl: options!.llmBaseUrl!,
      apiKey: options!.llmApiKey,
    });

    // §7d watchlist (T10): a `chatCompletion` rejection (network failure, auth failure,
    // `LLM_CHAT_COMPLETION_FAILED`) previously propagated straight out with no
    // `analyze.focused.error` JSONL line -- the CLI's own generic catch still reported it to the
    // console, but a background/non-interactive caller watching only `analyze.log` never saw it.
    // Mirrors the two existing explicit `FOCUSED_ERROR` sites in this method (kept as-is below,
    // since they're more specific than this blanket wrapper).
    let response;
    try {
      response = await llmClient.chatCompletion({
        model: options!.llmModel!,
        temperature: 0.2,
        messages: [
          {
            role: ChatMessageRoles.SYSTEM,
            content: DECISION_EXTRACTION_SYSTEM_PROMPT,
          },
          { role: ChatMessageRoles.USER, content: userMessage },
        ],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_ERROR,
        targetPath,
        message,
      });
      throw err;
    }

    const rawContent = response.choices[0]?.message.content;
    const decisions = parseDecisionsFromLlmContent(rawContent);
    if (decisions === undefined) {
      const message = ANALYZE_MESSAGES.LLM_NON_JSON_OUTPUT;
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_ERROR,
        targetPath,
        message,
      });
      throw new DocuviaError(ErrorCodes.LLM_INVALID_RESPONSE, message);
    }

    const { persisted, deduped } = await this.persistDecisions(
      resolvedPath,
      files,
      decisions,
    );

    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FOCUSED_SUMMARY,
      targetPath,
      decisionsCount: decisions.length,
    });

    return {
      kind: AnalyzeResultKind.DECISION_EXTRACTION,
      targetPath,
      decisions,
      persisted,
      deduped,
    };
  }

  /** Thin call into the standalone `persistDecisions` (`persist-l3-decisions.ts`, shared with
   *  the `--agent-authored` write path, issue #42) — passes `L3DecisionSources.ANALYZE`
   *  explicitly for symmetry/readability; the repo-level default from `IL3NodesRepo.upsertDecision`
   *  is the true backstop. See that module's doc comment for the full persist/anchor-resolution
   *  contract. */
  private async persistDecisions(
    resolvedTargetPath: string,
    files: CollectedFile[],
    decisions: ExtractedDecision[],
  ): Promise<{ persisted: number; deduped: number }> {
    const { workspaceRoot, logger, options } = this;
    return persistDecisions({
      workspaceRoot,
      logger,
      resolvedTargetPath,
      files,
      decisions,
      source: L3DecisionSources.ANALYZE,
      extractionModel: options?.llmModel ?? null,
    });
  }
}

type AnalyzeWorkflowOptions = NonNullable<
  ConstructorParameters<typeof AnalyzeWorkflow>[2]
>;

/** Knowledge branch is a dedicated orphan branch of small, purpose-built commits -- mirrors
 *  `HydrationService`'s identical scan-depth choice (see its own `KNOWLEDGE_LOG_SCAN_LIMIT`). */
const KNOWLEDGE_LOG_SCAN_LIMIT = 5000;

/**
 * Reads the `Docuvia-Source` trailer off the specific knowledge-branch commit
 * `tryHydrateThenDelta` resolved via `IHydrationService.resolveHydrationCommit` -- that method
 * only returns the knowledge-branch sha, not its paired source sha, so this is a second, small
 * log scan (roadmap item #11) rather than a `IHydrationService` interface change.
 */
async function resolveSourceShaForKnowledgeCommit(
  git: IGitProvider,
  workspaceRoot: string,
  knowledgeSha: string,
): Promise<string | undefined> {
  const log = await git.getCommitLog(
    workspaceRoot,
    GitConstants.KNOWLEDGE_ROOT,
    KNOWLEDGE_LOG_SCAN_LIMIT,
  );
  const entry = log.find((e) => e.sha === knowledgeSha);
  return entry ? parseSourceTrailer(entry.message) : undefined;
}

/** The Tier B-only slice of `runTierBBatch`'s deps -- split out of `buildTierBBatchDeps` to keep
 *  each function's optional-chaining-driven complexity under the ESLint budget. */
function buildTierBOnlyDeps(
  options: AnalyzeWorkflowOptions | undefined,
): Pick<
  TierBBatchDeps,
  | "providerConfig"
  | "commitCap"
  | "llmBaseUrl"
  | "llmApiKey"
  | "llmModel"
  | "full"
> {
  return {
    providerConfig: options?.lspProviderConfig,
    commitCap: options?.tierBCommitCap,
    llmBaseUrl: options?.llmBaseUrl,
    llmApiKey: options?.llmApiKey,
    llmModel: options?.llmModel,
    full: options?.full,
  };
}

/** The Tier C-only slice of `runTierBBatch`'s deps (§9d) -- split out of `buildTierBBatchDeps`
 *  for the same reason as `buildTierBOnlyDeps`. */
function buildTierCOnlyDeps(
  options: AnalyzeWorkflowOptions | undefined,
): Pick<
  TierBBatchDeps,
  | "tierCDailyCallCap"
  | "tierCDailyTokenCap"
  | "tierCWallClockMs"
  | "tierCItemCap"
  | "tierCLoadThreshold"
  | "tierCDrainAll"
> {
  return {
    tierCDailyCallCap: options?.tierCDailyCallCap,
    tierCDailyTokenCap: options?.tierCDailyTokenCap,
    tierCWallClockMs: options?.tierCWallClockMs,
    tierCItemCap: options?.tierCItemCap,
    tierCLoadThreshold: options?.tierCLoadThreshold,
    tierCDrainAll: options?.tierCDrainAll,
  };
}

/**
 * Assembles `runTierBBatch`'s deps object from `AnalyzeWorkflow`'s constructor options -- pulled
 * out of `executeTierBBatch` purely to keep that method's cyclomatic complexity under the
 * project's ESLint budget (the Tier C option fields added in Slice 4 pushed the inline object
 * literal's optional-chaining count over the limit).
 */
function buildTierBBatchDeps(
  workspaceRoot: string,
  logger: ILogger,
  store: IGraphStore,
  git: IGitProvider,
  knowledgeGit: IKnowledgeGitService,
  options: AnalyzeWorkflowOptions | undefined,
): TierBBatchDeps {
  return {
    workspaceRoot,
    logger,
    store,
    git,
    knowledgeGit,
    ...buildTierBOnlyDeps(options),
    ...buildTierCOnlyDeps(options),
    force: options?.force,
  };
}
