import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  docuviaFactory,
  TOKENS,
  UTF8_ENCODING,
  type IGraphStore,
  type IKnowledgeGitService,
} from "@workspace/contracts";
import {
  GitConstants,
  computeL2GitPathsByNodeId,
  renderL3Card,
} from "@workspace/core";
import { SNAPSHOT_TEMP_DIR_PREFIX } from "./snapshot-messages.js";
import type { SnapshotResult } from "./snapshot-result.js";

/**
 * The shared "render the current graph -> temp dir -> pack onto the knowledge branch" core, used
 * both by the standalone `snapshot` command (`SnapshotWorkflow`, which additionally does
 * staleness-skip checking, its own store open/close, and Tier B batch finalization) and by callers
 * that already hold an open store and want the knowledge branch to carry real content immediately
 * -- `init` and `analyze` auto mode's full-ingestion branch, both of which would otherwise leave
 * the branch's initial commit empty until the next manual `docuvia snapshot` or `git push`
 * (`KnowledgeGitService.ensureKnowledgeBranch`'s doc comment). Never skips and never opens its own
 * store -- the caller decides whether packing is warranted and owns the store's lifecycle.
 */
export async function packCurrentGraphOntoKnowledgeBranch(
  workspaceRoot: string,
  store: IGraphStore,
  knowledgeGit: IKnowledgeGitService,
): Promise<SnapshotResult> {
  const snapshotRenderer = docuviaFactory.resolve(TOKENS.SnapshotRenderer);

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

    await writeL3Cards(tempDir, store, l2Rows, linkRows);

    await knowledgeGit.packSnapshotToKnowledgeBranch(workspaceRoot, tempDir);

    return renderResult;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/** Verbatim copy of `SnapshotWorkflow`'s private `writeL3Cards` -- both call sites render the same
 *  `knowledge/_l3/<content_hash>.md` cards the same way. */
async function writeL3Cards(
  tempDir: string,
  store: IGraphStore,
  l2Rows: ReturnType<IGraphStore["graph"]["getAllNodes"]>,
  linkRows: ReturnType<IGraphStore["graph"]["getAllLinks"]>,
): Promise<void> {
  const l3Rows = store.l3.getAllExportable();
  if (l3Rows.length === 0) return;

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
