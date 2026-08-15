import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type IGraphStore,
  type ILogger,
  type L3DecisionSource,
} from "@workspace/contracts";
import { ANALYZE_EVENTS } from "./analyze-messages.js";
import { ANALYZE_MESSAGES } from "./analyze-messages.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
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
}): Promise<{ persisted: number; deduped: number }> {
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
  if (decisions.length === 0) return { persisted: 0, deduped: 0 };

  const store = await openStoreForPersist(workspaceRoot, logger);
  if (store === null) return { persisted: 0, deduped: 0 };

  try {
    const project = store.projects.getFirst();
    if (!project) {
      await warnNoGraphToAttach(workspaceRoot, logger);
      return { persisted: 0, deduped: 0 };
    }

    const anchorL2NodeId = resolveAnchorL2NodeId(
      store,
      workspaceRoot,
      resolvedTargetPath,
      files,
    );
    if (anchorL2NodeId === undefined) {
      await warnNoGraphToAttach(workspaceRoot, logger);
      return { persisted: 0, deduped: 0 };
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
    });

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
  /** See `persistDecisions`'s own doc comment on this field. */
  commitSha?: string;
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
