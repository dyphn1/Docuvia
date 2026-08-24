import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  docuviaFactory,
  TOKENS,
  type IGraphStore,
  type IKnowledgeGitService,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
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
 *
 * L3 decision cards are rendered by `ISnapshotRenderer` itself (the rows are passed straight
 * through as `l3Rows`) -- this layer never touches card rendering details (issue #206).
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
      l3Rows: store.l3.getAllExportable(),
    });

    await store.withWriteLock(() => {
      store.meta.set(GitConstants.META_KEY_KNOWLEDGE_PACK_PENDING, "true");
    });

    await knowledgeGit.packSnapshotToKnowledgeBranch(workspaceRoot, tempDir);

    await store.withWriteLock(() => {
      store.meta.set(GitConstants.META_KEY_KNOWLEDGE_PACK_PENDING, "");
    });

    return renderResult;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
