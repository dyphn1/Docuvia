import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type ILogger,
} from "@workspace/contracts";
import {
  SNAPSHOT_EVENTS,
  SNAPSHOT_MESSAGES,
  SNAPSHOT_TEMP_DIR_PREFIX,
} from "./snapshot-messages.js";
import { appendSnapshotLogLine } from "./snapshot-log-writer.js";
import type { SnapshotResult } from "./snapshot-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";

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
    const snapshotRenderer = docuviaFactory.resolve(TOKENS.SnapshotRenderer);

    let store;
    try {
      store = await openStore({
        dbPath: resolveDbPath(workspaceRoot),
        readonly: true,
      });
    } catch (err) {
      if (
        err instanceof DocuviaError &&
        err.code === ErrorCodes.DB_OPEN_FAILED
      ) {
        await appendSnapshotLogLine(workspaceRoot, {
          event: SNAPSHOT_EVENTS.ERROR,
          message: SNAPSHOT_MESSAGES.DB_NOT_FOUND,
        });
        throw new DocuviaError(
          ErrorCodes.DB_OPEN_FAILED,
          SNAPSHOT_MESSAGES.DB_NOT_FOUND,
          err,
        );
      }
      throw err;
    }

    try {
      const l2Rows = store.graph.getAllNodes();
      const linkRows = store.graph.getAllLinks();

      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), SNAPSHOT_TEMP_DIR_PREFIX),
      );
      try {
        const renderResult = await snapshotRenderer.render({
          outDir: tempDir,
          l2Rows,
          linkRows,
        });

        await knowledgeGit.packSnapshotToKnowledgeBranch(
          workspaceRoot,
          tempDir,
        );

        await appendSnapshotLogLine(workspaceRoot, {
          event: SNAPSHOT_EVENTS.SUMMARY,
          nodesWritten: renderResult.nodesWritten,
          edgesWritten: renderResult.edgesWritten,
          markdownFilesWritten: renderResult.markdownFilesWritten,
        });

        return renderResult;
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } finally {
      await store.close();
    }
  }
}
