import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type IGraphStore,
  type ILogger,
  type L3DecisionSource,
  type L3NodeRow,
} from "@workspace/contracts";
import { ANALYZE_EVENTS } from "./analyze-messages.js";
import { ANALYZE_MESSAGES } from "./analyze-messages.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import { findAnchorContradictions } from "./check-l3-contradictions.js";
import { captureAnchorRanges } from "./capture-anchor-ranges.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { resolveAnchorL2NodeId, toNodeKey } from "./anchor-resolution.js";
import type { CollectedFile } from "./decision-extraction.js";
import type { ExtractedDecision } from "./analyze-result.js";

/**
 * Writes `decisions` through to `l3_nodes` (phase1-decision-integration.md §3, PLAT-007 Tier C
 * point 1) -- shared by both `AnalyzeWorkflow`'s LLM-extraction path and the `--agent-authored`
 * write path (`run-agent-authored-write.ts`, issue #42). Resolves the `NOT NULL` `l2_node_id`
 * anchor via `resolveAnchorL2NodeId`; when it can't be resolved (empty/not-yet-ingested graph),
 * persists nothing and warns rather than inventing a synthetic L2 node — decisions are still
 * returned to the caller either way, and this never throws (a missing local database is a
 * legitimate, expected precondition here, not a failure of the extraction itself). Standalone
 * (not an `AnalyzeWorkflow` method), mirroring how `resolveAnchorL2NodeId`/`collectSourceFiles`/
 * `toNodeKey` are already standalone functions this workflow calls into rather than private
 * methods.
 */
export async function persistDecisions(deps: {
  workspaceRoot: string;
  logger: ILogger;
  resolvedTargetPath: string;
  files: CollectedFile[];
  decisions: ExtractedDecision[];
  /** `l3_nodes.source` to stamp on every newly-inserted row this call produces. */
  source: L3DecisionSource;
  extractionModel: string | null;
  /** Explicit `commitSha` override -- when omitted (every caller before issue #42's flush step),
   *  `upsertDecisions` resolves it itself via `git.getHeadSha()` (workspace HEAD at persist time),
   *  unchanged from before. `run-flush-staged-l3.ts` is the one caller that must pass this
   *  explicitly: it stamps the *exact* commit that triggered the flush (structurally the same
   *  value as `HEAD` at that moment, but explicit here for clarity/testability rather than
   *  implicit "whatever HEAD happens to be when the DB write executes"). */
  commitSha?: string;
  /**
   * When `true`, runs the deterministic writer-side contradiction check (issue #68) against the
   * decisions already anchored to the same `l2_node_id` before writing, warning via the
   * injected logger when a staged decision re-states an existing titled claim with divergent
   * content. Warn-only -- never blocks or alters the write. Off by default: only the flush
   * path (`run-flush-staged-l3.ts`) opts in today.
   */
  warnOnAnchorContradictions?: boolean;
  /**
   * When `true`, captures the writing commit's diff hunks as region anchors (issue #68) and
   * stamps them on every freshly-inserted row this call produces. Off by default: only the
   * flush path (`run-flush-staged-l3.ts`) opts in today, keeping the analyze pipeline's
   * per-call git subprocess cost unchanged.
   */
  captureAnchorRanges?: boolean;
}): Promise<{
  persisted: number;
  deduped: number;
  /** `true` when this call hit the §3b no-graph-to-attach path (db missing, no project row, or
   *  no L2 anchor resolvable) and persisted nothing -- the caller can distinguish "genuinely
   *  written" from "swallowed skip" without re-deriving the graph state itself. The flush path
   *  (`run-flush-staged-l3.ts`) surfaces this as a loud "run `docuvia init`" nudge (issue #57). */
  noGraphToAttach: boolean;
}> {
  const {
    workspaceRoot,
    logger,
    resolvedTargetPath,
    files,
    decisions,
    source,
    extractionModel,
    commitSha,
  } = deps;
  if (decisions.length === 0)
    return { persisted: 0, deduped: 0, noGraphToAttach: false };

  const store = await openStoreForPersist(workspaceRoot, logger);
  if (store === null)
    return { persisted: 0, deduped: 0, noGraphToAttach: true };

  try {
    const project = store.projects.getFirst();
    if (!project) {
      await warnNoGraphToAttach(workspaceRoot, logger);
      return { persisted: 0, deduped: 0, noGraphToAttach: true };
    }

    const anchorL2NodeId = resolveAnchorL2NodeId(
      store,
      workspaceRoot,
      resolvedTargetPath,
      files,
    );
    if (anchorL2NodeId === undefined) {
      await warnNoGraphToAttach(workspaceRoot, logger);
      return { persisted: 0, deduped: 0, noGraphToAttach: true };
    }

    if (deps.warnOnAnchorContradictions) {
      // Strictly advisory -- a repo returning nothing here degrades to "no contradictions
      // found", never aborting the write it precedes.
      warnAnchorContradictions(
        store.l3.getByL2NodeId(anchorL2NodeId) ?? [],
        decisions,
        logger,
      );
    }

    const counts = await upsertDecisions({
      workspaceRoot,
      store,
      projectId: project.id,
      anchorL2NodeId,
      files,
      decisions,
      source,
      extractionModel,
      commitSha,
      captureAnchorRanges: deps.captureAnchorRanges,
    });

    await appendAnalyzeLogLine(workspaceRoot, {
      event: ANALYZE_EVENTS.FOCUSED_PERSISTED,
      persisted: counts.persisted,
      deduped: counts.deduped,
    });

    return { ...counts, noGraphToAttach: false };
  } finally {
    await store.close();
  }
}

/** The issue #68 writer-side check: log a warning per deterministic contradiction between the
 *  incoming decisions and live rows on the same anchor. A separate function purely to keep
 *  `persistDecisions` under its complexity budget. */
function warnAnchorContradictions(
  existingRows: L3NodeRow[],
  decisions: ExtractedDecision[],
  logger: ILogger,
): void {
  for (const hit of findAnchorContradictions(existingRows, decisions)) {
    logger.warn(
      ANALYZE_MESSAGES.L3_ANCHOR_CONTRADICTION(
        hit.stagedTitle,
        hit.existingSource,
        hit.existingCommitHash,
      ),
      {
        stagedTitle: hit.stagedTitle,
        existingId: hit.existingId,
        existingTitle: hit.existingTitle,
        existingSource: hit.existingSource,
        existingCommitHash: hit.existingCommitHash,
      },
    );
  }
}

/** Opens the store for the persist step; a missing/unopenable local database is the §3b
 *  empty-graph precondition (warn + skip), not a failure of the extraction itself. */
async function openStoreForPersist(
  workspaceRoot: string,
  logger: ILogger,
): Promise<IGraphStore | null> {
  const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
  try {
    return await openStore({
      dbPath: resolveDbPath(workspaceRoot),
      readonly: false,
    });
  } catch (err) {
    if (err instanceof DocuviaError && err.code === ErrorCodes.DB_OPEN_FAILED) {
      await warnNoGraphToAttach(workspaceRoot, logger);
      return null;
    }
    throw err;
  }
}

/** The §3c content-hash upsert loop — every decision lands as a new row or an occurrence bump. */
async function upsertDecisions(deps: {
  workspaceRoot: string;
  store: IGraphStore;
  projectId: number;
  anchorL2NodeId: number;
  files: CollectedFile[];
  decisions: ExtractedDecision[];
  source: L3DecisionSource;
  extractionModel: string | null;
  /** See `persistDecisions`'s doc comment on this field. */
  commitSha?: string;
  /** See `persistDecisions`'s doc comment on this field. */
  captureAnchorRanges?: boolean;
}): Promise<{ persisted: number; deduped: number }> {
  const {
    workspaceRoot,
    store,
    projectId,
    anchorL2NodeId,
    files,
    decisions,
    source,
    extractionModel,
  } = deps;
  const resolvedCommitSha =
    deps.commitSha ??
    (await docuviaFactory
      .resolve(TOKENS.GitProvider)
      .getHeadSha(workspaceRoot)) ??
    null;
  const sourceFiles = files.map((f) => toNodeKey(f.relativePath));

  // Issue #68: capture the writing commit's diff hunks as region anchors, once per call (the
  // ranges describe the commit's change, identical for every decision in this group). Null on
  // a null sha or capture failure -- stored as "unknown region", never fabricated.
  const anchorRanges = deps.captureAnchorRanges
    ? await captureAnchorRanges({
        git: docuviaFactory.resolve(TOKENS.GitProvider),
        workspaceRoot,
        commitSha: resolvedCommitSha,
        sourceFiles,
      })
    : null;

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
      commitSha: resolvedCommitSha,
      extractionModel,
      sourceFiles,
      source,
      // Omitted entirely when capture is off, so callers not opting in keep byte-identical
      // upsert inputs (and the column stays NULL = "unknown region").
      ...(deps.captureAnchorRanges ? { anchorRanges } : {}),
    });
    if (result.deduped) deduped++;
    else persisted++;
  }

  return { persisted, deduped };
}

async function warnNoGraphToAttach(
  workspaceRoot: string,
  logger: ILogger,
): Promise<void> {
  logger.warn(ANALYZE_MESSAGES.NO_GRAPH_TO_ATTACH);
  await appendAnalyzeLogLine(workspaceRoot, {
    event: ANALYZE_EVENTS.FOCUSED_PERSIST_SKIPPED,
    message: ANALYZE_MESSAGES.NO_GRAPH_TO_ATTACH,
  });
}
