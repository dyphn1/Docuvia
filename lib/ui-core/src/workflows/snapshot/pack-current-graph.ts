import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  docuviaFactory,
  SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX,
  SNAPSHOT_CALL_RESOLUTIONS_AVAILABILITY_META_KEY_PREFIX,
  TOKENS,
  SnapshotCallSiteAvailabilityStates,
  SnapshotCallResolutionAvailabilityStates,
  type IGraphStore,
  type IKnowledgeGitService,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import {
  DYNAMIC_DEPENDENCY_EVIDENCE_META_KEY_PREFIX,
  KNOWLEDGE_SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_CALL_SITES_VERSION,
  SNAPSHOT_CALL_RESOLUTIONS_VERSION,
  SNAPSHOT_DYNAMIC_EVIDENCE_VERSION,
} from "@workspace/contracts";
import { SNAPSHOT_TEMP_DIR_PREFIX } from "./snapshot-messages.js";
import type { SnapshotResult } from "./snapshot-result.js";

function getCallSitesForSnapshot(
  store: IGraphStore,
  project: ReturnType<IGraphStore["projects"]["getFirst"]>,
) {
  if (!project || !store.callSites.getAllForProject) return undefined;

  const availability = store.meta.get(
    `${SNAPSHOT_CALL_SITES_AVAILABILITY_META_KEY_PREFIX}${project.id}`,
  );
  if (
    availability !== undefined &&
    availability !== SnapshotCallSiteAvailabilityStates.AVAILABLE
  ) {
    return undefined;
  }

  return store.callSites.getAllForProject(project.id);
}

function getCallResolutionsForSnapshot(
  store: IGraphStore,
  project: ReturnType<IGraphStore["projects"]["getFirst"]>,
  callSitesAvailable: boolean,
) {
  if (
    !project ||
    !callSitesAvailable ||
    !store.callSiteResolutions?.getAllForProject
  ) {
    return undefined;
  }
  const availability = store.meta.get(
    `${SNAPSHOT_CALL_RESOLUTIONS_AVAILABILITY_META_KEY_PREFIX}${project.id}`,
  );
  if (
    availability !== undefined &&
    availability !== SnapshotCallResolutionAvailabilityStates.AVAILABLE
  ) {
    return undefined;
  }
  return store.callSiteResolutions.getAllForProject(project.id);
}

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
  const project = store.projects.getFirst();
  const fileMetadata = store.files.getAllSnapshotMetadata();
  // A missing marker is a locally ingested database. Preserve an explicit unavailable marker
  // so re-snapshotting cannot turn an incomplete hydrated set into a complete empty set.
  const callSites = getCallSitesForSnapshot(store, project);
  const callResolutions = getCallResolutionsForSnapshot(
    store,
    project,
    callSites !== undefined,
  );
  const dynamicEvidence = project
    ? store.meta.get(
        `${DYNAMIC_DEPENDENCY_EVIDENCE_META_KEY_PREFIX}${project.id}`,
      )
    : undefined;
  const capabilities = {
    ...(dynamicEvidence !== undefined
      ? {
          dynamicDependencyEvidence: {
            version: SNAPSHOT_DYNAMIC_EVIDENCE_VERSION,
            payload: dynamicEvidence,
          },
        }
      : {}),
    ...(callSites !== undefined
      ? { callSites: { version: SNAPSHOT_CALL_SITES_VERSION } }
      : {}),
    ...(callResolutions !== undefined
      ? { callResolutions: { version: SNAPSHOT_CALL_RESOLUTIONS_VERSION } }
      : {}),
  };

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), SNAPSHOT_TEMP_DIR_PREFIX),
  );
  try {
    const renderResult = await snapshotRenderer.render({
      outDir: tempDir,
      l2Rows,
      linkRows,
      ...(callSites !== undefined ? { callSites } : {}),
      ...(callResolutions !== undefined ? { callResolutions } : {}),
      l3Rows: store.l3.getAllExportable(),
      metadata: {
        project: project
          ? { name: project.name, repoUrl: project.repo_url }
          : undefined,
        files: fileMetadata,
        lastIngestedSourceSha: store.meta.get(
          GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
        ),
        snapshotVersion: KNOWLEDGE_SNAPSHOT_FORMAT_VERSION,
        ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
      },
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
