import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type ILogger,
  type IGraphStore,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import { SNAPSHOT_EVENTS, SNAPSHOT_MESSAGES } from "./snapshot-messages.js";
import { appendSnapshotLogLine } from "./snapshot-log-writer.js";
import type { SnapshotResult } from "./snapshot-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { finalizePendingTierBBatch } from "./finalize-pending-tier-b-batch.js";
import { packCurrentGraphOntoKnowledgeBranch } from "./pack-current-graph.js";

/**
 * The `snapshot` workflow — bulk-reads the current knowledge graph from `IGraphStore` (the same
 * `getAllNodes`/`getAllLinks` methods `export-topology` uses), hands the rows to the Domain
 * Core's `ISnapshotRenderer` to render into a scratch directory (`graph/*.jsonl` +
 * per-file/symbol markdown), then packs that directory onto the hidden knowledge branch via
 * `IKnowledgeGitService`. Deliberately does not re-run file-discovery/AST-parsing — that data is
 * already persisted in SQLite by `init`/`sync`; this only re-renders it into the git-native
 * branch view.
 */
export class SnapshotWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  /**
   * Opens read-write (not `readonly: true`, despite this workflow otherwise only *reading* graph
   * rows to render): `packCurrentGraphOntoKnowledgeBranch`'s pending-write guard flag
   * (`META_KEY_KNOWLEDGE_PACK_PENDING`, 2026-08 vscode data-loss finding) writes to this same
   * store via `store.withWriteLock`/`store.meta.set` around the pack call, which throws "attempt
   * to write a readonly database" against a genuinely readonly better-sqlite3 connection.
   */
  private async openStoreForSnapshot(openStore: any): Promise<IGraphStore> {
    try {
      return await openStore({
        dbPath: resolveDbPath(this.workspaceRoot),
        readonly: false,
      });
    } catch (err) {
      if (err instanceof DocuviaError && err.code === ErrorCodes.DB_NOT_FOUND) {
        await appendSnapshotLogLine(this.workspaceRoot, {
          event: SNAPSHOT_EVENTS.ERROR,
          message: SNAPSHOT_MESSAGES.DB_NOT_FOUND,
        });
        throw new DocuviaError(
          ErrorCodes.DB_NOT_FOUND,
          SNAPSHOT_MESSAGES.DB_NOT_FOUND,
          err,
        );
      }
      throw err;
    }
  }

  private async shouldSkipSnapshot(
    knowledgeGit: any,
    store: IGraphStore,
  ): Promise<{ shouldSkip: boolean; headSha: string | null }> {
    const git = docuviaFactory.resolve(TOKENS.GitProvider);
    const headSha = (await git.getHeadSha(this.workspaceRoot)) ?? null;
    const isAlreadySnapshotted =
      headSha && typeof knowledgeGit.hasSourceCommitInHistory === "function"
        ? await knowledgeGit.hasSourceCommitInHistory(
            this.workspaceRoot,
            headSha,
          )
        : false;
    const pending = store.meta.get(GitConstants.META_KEY_TIER_B_BATCH_PENDING);
    const lastTierB = store.meta.get(
      GitConstants.META_KEY_LAST_TIER_B_BATCH_SHA,
    );
    const tierCProcessed = store.meta.get("tierCProcessedThisRun") === "true";

    const shouldSkip = !!(
      headSha &&
      isAlreadySnapshotted &&
      lastTierB === headSha &&
      !pending &&
      !tierCProcessed
    );

    return { shouldSkip, headSha };
  }

  public async execute(): Promise<SnapshotResult> {
    const { workspaceRoot, logger } = this;

    logger.info(SNAPSHOT_MESSAGES.SNAPSHOTTING);
    await appendSnapshotLogLine(workspaceRoot, {
      event: SNAPSHOT_EVENTS.START,
      workspaceRoot,
    });

    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger,
    });

    const store = await this.openStoreForSnapshot(openStore);

    try {
      const { shouldSkip, headSha } = await this.shouldSkipSnapshot(
        knowledgeGit,
        store,
      );

      if (shouldSkip) {
        logger.info(
          "Knowledge graph snapshot is already up to date with HEAD, skipping.",
        );
        await appendSnapshotLogLine(workspaceRoot, {
          event: "snapshot.skipped",
          reason: "already-up-to-date",
          headSha,
        });
        return {
          nodesWritten: 0,
          edgesWritten: 0,
          markdownFilesWritten: 0,
        };
      }

      const renderResult = await packCurrentGraphOntoKnowledgeBranch(
        workspaceRoot,
        store,
        knowledgeGit,
      );

      // §8g/§8f: this successful pack IS "a successful snapshot" -- finalize any Tier B batch
      // an `analyze --escalate-to-lsp` run staged (queue drain + commit-cap seed). Cheap no-op
      // when nothing is pending (the common case).
      await finalizePendingTierBBatch(workspaceRoot, logger);

      await appendSnapshotLogLine(workspaceRoot, {
        event: SNAPSHOT_EVENTS.SUMMARY,
        nodesWritten: renderResult.nodesWritten,
        edgesWritten: renderResult.edgesWritten,
        markdownFilesWritten: renderResult.markdownFilesWritten,
      });

      return renderResult;
    } finally {
      await store.close();
    }
  }
}
