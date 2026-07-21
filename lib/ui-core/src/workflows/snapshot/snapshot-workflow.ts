import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  UTF8_ENCODING,
  type ILogger,
} from "@workspace/contracts";
import {
  GitConstants,
  computeL2GitPathsByNodeId,
  renderL3Card,
} from "@workspace/core";
import {
  SNAPSHOT_EVENTS,
  SNAPSHOT_MESSAGES,
  SNAPSHOT_TEMP_DIR_PREFIX,
} from "./snapshot-messages.js";
import { appendSnapshotLogLine } from "./snapshot-log-writer.js";
import type { SnapshotResult } from "./snapshot-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { finalizePendingTierBBatch } from "./finalize-pending-tier-b-batch.js";

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

        // §3 wiring (phase2-l3-distribution.md): render the current getAllExportable() set as
        // one card per content_hash under knowledge/_l3/, in the same tempDir, before packing --
        // this is also what L3DIST-006's self-healing relies on (a full re-render every run, not
        // a diff, so a wiped card comes back on the very next snapshot without any extra logic).
        const l3Rows = store.l3.getAllExportable();
        if (l3Rows.length > 0) {
          const l2GitPaths = computeL2GitPathsByNodeId(l2Rows, linkRows);
          const l3Dir = path.join(
            tempDir,
            GitConstants.KNOWLEDGE_DIR_NAME,
            GitConstants.L3_DIR_NAME,
          );
          await fs.mkdir(l3Dir, { recursive: true });
          await Promise.all(
            l3Rows.map(async (row) => {
              if (!row.content_hash) return;
              const l2Path = l2GitPaths.get(row.l2_node_id);
              if (!l2Path) return;
              await fs.writeFile(
                path.join(l3Dir, `${row.content_hash}.md`),
                renderL3Card(row, l2Path),
                UTF8_ENCODING,
              );
            }),
          );
        }

        await knowledgeGit.packSnapshotToKnowledgeBranch(
          workspaceRoot,
          tempDir,
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
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } finally {
      await store.close();
    }
  }
}
