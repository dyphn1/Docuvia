import fs from "fs";
import path from "path";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  ChatMessageRoles,
  type IGitProvider,
  type IGraphStore,
  type IKnowledgeGitService,
  type ILogger,
  type EdgeResolutionProviderConfig,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
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
import { resolveAnchorL2NodeId, toNodeKey } from "./anchor-resolution.js";
import {
  AnalyzeResultKind,
  DecisionNodeType,
  type AnalyzeResult,
  type ExtractedDecision,
} from "./analyze-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { runFullIngestion } from "./run-full-ingestion.js";
import { runDeltaIngestion } from "./run-delta-ingestion.js";
import { runTierBBatch } from "./run-tier-b-batch.js";

const VALID_NODE_TYPES = Object.values(DecisionNodeType);
const MARKDOWN_CODE_FENCE = "```";

/**
 * Strips a wrapping markdown code fence (```` ```json\n...\n``` ```` or bare ```` ```\n...\n``` ````)
 * from `raw`, tolerating leading/trailing whitespace around the fence. Many OpenAI-compatible LLM
 * backends (e.g. Mistral) wrap valid JSON responses in a markdown fence even when not asked to,
 * which breaks a direct `JSON.parse()`. If `raw` isn't fenced, it is returned unchanged.
 */
export function stripMarkdownCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (
    !trimmed.startsWith(MARKDOWN_CODE_FENCE) ||
    !trimmed.endsWith(MARKDOWN_CODE_FENCE)
  ) {
    return raw;
  }

  const newlineIndex = trimmed.indexOf("\n");
  if (newlineIndex === -1) {
    // A single line of nothing but backticks (and maybe a language tag) — no body to extract.
    return raw;
  }

  const firstLine = trimmed.slice(0, newlineIndex);
  if (!/^```[A-Za-z0-9_-]*$/.test(firstLine)) {
    // Opening "fence" line contains more than just ``` + an optional language tag — not a
    // fence we recognize; leave the content untouched rather than risk mangling it.
    return raw;
  }

  const withoutOpening = trimmed.slice(newlineIndex + 1);
  const withoutClosing = withoutOpening.slice(0, withoutOpening.length - 3);
  return withoutClosing.trim();
}

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
      llmBaseUrl?: string;
      llmApiKey?: string;
      llmModel?: string;
      /** `analyze --escalate-to-lsp` (PLAT-007 Tier B; phase1-decision-integration.md §8) -- a
       *  sibling mode to auto mode / focused extraction, mutually exclusive with `targetPath`. */
      escalateToLsp?: boolean;
      lspProviderConfig?: EdgeResolutionProviderConfig;
      tierBCommitCap?: number;
    },
  ) {}

  public async execute(): Promise<AnalyzeResult> {
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

      return await runTierBBatch({
        workspaceRoot,
        logger,
        store,
        git,
        knowledgeGit,
        providerConfig: options?.lspProviderConfig,
        commitCap: options?.tierBCommitCap,
      });
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
   *   1. Sha fast-path (§6a, "must be the first check"): `HEAD === lastIngestedSourceSha` -> noop.
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

    // 1. Sha fast-path — first check, regardless of graph state.
    if (headSha && lastIngestedSha && headSha === lastIngestedSha) {
      logger.info(ANALYZE_MESSAGES.AUTO_NOOP);
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.DELTA_NOOP,
        headSha,
      });
      return { kind: AnalyzeResultKind.AUTO_DELTA_NOOP, headSha };
    }

    // 2. Empty-graph check -> full ingestion.
    const project = store.projects.getFirst();
    const { l2Nodes } = store.graph.count();
    if (!project || l2Nodes === 0) {
      return await runFullIngestion({ workspaceRoot, logger, store, git });
    }

    // Non-empty graph but nothing to diff against (unborn/headless HEAD, no commits yet) —
    // an extremely unlikely combination (the graph would ordinarily only be populated via a
    // full ingestion or git hydration, both of which need at least one commit), but treated as
    // a harmless no-op rather than crashing on a `git diff` against a ref that doesn't exist.
    if (!headSha) {
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.DELTA_NO_HEAD,
      });
      return { kind: AnalyzeResultKind.AUTO_DELTA_NOOP, headSha: null };
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

    const response = await llmClient.chatCompletion({
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

    const rawContent = response.choices[0]?.message.content;
    let parsed: unknown;
    if (rawContent === null || rawContent === undefined) {
      const message = ANALYZE_MESSAGES.LLM_NON_JSON_OUTPUT;
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_ERROR,
        targetPath,
        message,
      });
      throw new DocuviaError(ErrorCodes.LLM_INVALID_RESPONSE, message);
    }
    try {
      parsed = JSON.parse(stripMarkdownCodeFence(rawContent));
    } catch {
      const message = ANALYZE_MESSAGES.LLM_NON_JSON_OUTPUT;
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_ERROR,
        targetPath,
        message,
      });
      throw new DocuviaError(ErrorCodes.LLM_INVALID_RESPONSE, message);
    }

    if (!Array.isArray(parsed)) {
      const message = ANALYZE_MESSAGES.LLM_NON_JSON_OUTPUT;
      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_ERROR,
        targetPath,
        message,
      });
      throw new DocuviaError(ErrorCodes.LLM_INVALID_RESPONSE, message);
    }

    const decisions: ExtractedDecision[] = parsed.map((item: any) => ({
      title: String(item?.title ?? ""),
      nodeType: (VALID_NODE_TYPES as readonly string[]).includes(item?.nodeType)
        ? (item.nodeType as ExtractedDecision["nodeType"])
        : DecisionNodeType.CONTEXT,
      content: String(item?.content ?? ""),
      confidence: typeof item?.confidence === "number" ? item.confidence : 0,
    }));

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

  /**
   * Writes `decisions` through to `l3_nodes` (phase1-decision-integration.md §3, PLAT-007 Tier C
   * point 1). Resolves the `NOT NULL` `l2_node_id` anchor via `resolveAnchorL2NodeId`; when it
   * can't be resolved (empty/not-yet-ingested graph), persists nothing and warns rather than
   * inventing a synthetic L2 node — decisions are still returned to the caller either way, and
   * this never throws (a missing local database is a legitimate, expected precondition here, not
   * a failure of the extraction itself).
   */
  private async persistDecisions(
    resolvedTargetPath: string,
    files: CollectedFile[],
    decisions: ExtractedDecision[],
  ): Promise<{ persisted: number; deduped: number }> {
    if (decisions.length === 0) return { persisted: 0, deduped: 0 };

    const { workspaceRoot } = this;

    const store = await this.openStoreForPersist(workspaceRoot);
    if (store === null) return { persisted: 0, deduped: 0 };

    try {
      const project = store.projects.getFirst();
      if (!project) {
        await this.warnNoGraphToAttach(workspaceRoot);
        return { persisted: 0, deduped: 0 };
      }

      const anchorL2NodeId = resolveAnchorL2NodeId(
        store,
        workspaceRoot,
        resolvedTargetPath,
        files,
      );
      if (anchorL2NodeId === undefined) {
        await this.warnNoGraphToAttach(workspaceRoot);
        return { persisted: 0, deduped: 0 };
      }

      const counts = await this.upsertDecisions(
        store,
        project.id,
        anchorL2NodeId,
        files,
        decisions,
      );

      await appendAnalyzeLogLine(workspaceRoot, {
        event: ANALYZE_EVENTS.FOCUSED_PERSISTED,
        persisted: counts.persisted,
        deduped: counts.deduped,
      });

      return counts;
    } finally {
      await store.close();
    }
  }

  /** Opens the store for the persist step; a missing/unopenable local database is the §3b
   *  empty-graph precondition (warn + skip), not a failure of the extraction itself. */
  private async openStoreForPersist(
    workspaceRoot: string,
  ): Promise<IGraphStore | null> {
    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    try {
      return await openStore({
        dbPath: resolveDbPath(workspaceRoot),
        readonly: false,
      });
    } catch (err) {
      if (
        err instanceof DocuviaError &&
        err.code === ErrorCodes.DB_OPEN_FAILED
      ) {
        await this.warnNoGraphToAttach(workspaceRoot);
        return null;
      }
      throw err;
    }
  }

  /** The §3c content-hash upsert loop — every decision lands as a new row or an occurrence bump. */
  private async upsertDecisions(
    store: IGraphStore,
    projectId: number,
    anchorL2NodeId: number,
    files: CollectedFile[],
    decisions: ExtractedDecision[],
  ): Promise<{ persisted: number; deduped: number }> {
    const { workspaceRoot, options } = this;
    const git = docuviaFactory.resolve(TOKENS.GitProvider);
    const commitSha = (await git.getHeadSha(workspaceRoot)) ?? null;
    const sourceFiles = files.map((f) => toNodeKey(f.relativePath));

    let persisted = 0;
    let deduped = 0;
    for (const decision of decisions) {
      const result = store.l3.upsertDecision({
        projectId,
        l2NodeId: anchorL2NodeId,
        title: decision.title,
        content: decision.content,
        nodeType: decision.nodeType,
        confidence: decision.confidence,
        commitSha,
        extractionModel: options?.llmModel ?? null,
        sourceFiles,
      });
      if (result.deduped) deduped++;
      else persisted++;
    }

    return { persisted, deduped };
  }

  private async warnNoGraphToAttach(workspaceRoot: string): Promise<void> {
    this.logger.warn(ANALYZE_MESSAGES.NO_GRAPH_TO_ATTACH);
    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FOCUSED_PERSIST_SKIPPED,
      message: ANALYZE_MESSAGES.NO_GRAPH_TO_ATTACH,
    });
  }
}
