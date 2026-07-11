import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type ILogger,
  type SyncPushEvent,
} from "@workspace/contracts";
import { SYNC_MESSAGES } from "./sync-messages.js";
import { appendSyncLogLine } from "./sync-log-writer.js";
import { loadSyncState, saveSyncState } from "./sync-state.js";
import type { SyncResult } from "./sync-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";

/**
 * The `sync` workflow — pushes locally-generated L3 decisions to the remote Docuvia backend for
 * a set of changed files (mirrors old Docuvia's `SyncService.sync`). Resolves the changed-file
 * set via `IGitProvider` (a specific commit when `commitSha` is given, else working-tree
 * modified+untracked files), matches it against local `l2_nodes`/`l3_nodes` via
 * `IGraphNodesRepo.findNodesForChangedFiles`, dedups against a local content-hash cache
 * (`sync-state.json`), and pushes the remainder via `IRemoteSyncClient`.
 */
export class SyncWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
    private readonly apiUrl: string,
    private readonly pat: string
  ) {}

  public async execute(input: { projectId: string; commitSha?: string }): Promise<SyncResult> {
    const { workspaceRoot, logger } = this;
    const { projectId, commitSha } = input;

    logger.info(SYNC_MESSAGES.STARTING(projectId));
    await appendSyncLogLine(workspaceRoot, {
      event: "sync.start",
      projectId,
      commitSha: commitSha ?? null,
    });

    const git = docuviaFactory.resolve(TOKENS.GitProvider);
    const changedFiles = commitSha
      ? await git.getFilesChangedByCommit(workspaceRoot, commitSha)
      : [
          ...(await git.listModifiedFiles(workspaceRoot)),
          ...(await git.listUntrackedFiles(workspaceRoot)),
        ];

    const changedFilesSet = new Set(changedFiles.filter(Boolean));
    if (changedFilesSet.size === 0) {
      const result: SyncResult = { synced: 0, skipped: 0, message: SYNC_MESSAGES.NOTHING_TO_SYNC };
      await appendSyncLogLine(workspaceRoot, { event: "sync.summary", projectId, ...result });
      return result;
    }

    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    let store;
    try {
      store = await openStore({ dbPath: resolveDbPath(workspaceRoot), readonly: true });
    } catch (err) {
      if (err instanceof DocuviaError && err.code === ErrorCodes.DB_OPEN_FAILED) {
        await appendSyncLogLine(workspaceRoot, {
          event: "sync.error",
          projectId,
          message: SYNC_MESSAGES.DB_NOT_FOUND,
        });
        throw new DocuviaError(ErrorCodes.DB_OPEN_FAILED, SYNC_MESSAGES.DB_NOT_FOUND, err);
      }
      throw err;
    }

    try {
      const buildRemoteSyncClient = docuviaFactory.resolve(TOKENS.RemoteSyncClient);
      const remoteSyncClient = buildRemoteSyncClient();
      remoteSyncClient.initialize({ apiUrl: this.apiUrl, pat: this.pat });

      let remoteL2Nodes;
      try {
        remoteL2Nodes = await remoteSyncClient.fetchRemoteL2Nodes(projectId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await appendSyncLogLine(workspaceRoot, { event: "sync.error", projectId, message });
        throw err;
      }
      const nameToRemoteId = new Map(remoteL2Nodes.map((n) => [n.name, n.id]));

      const candidates = store.graph.findNodesForChangedFiles(Array.from(changedFilesSet));

      const syncState = await loadSyncState(workspaceRoot);
      const projectState = syncState[projectId] ?? { syncedContentHashes: [] };
      const syncedHashes = new Set(projectState.syncedContentHashes);

      const events: SyncPushEvent[] = [];
      const newlySyncedHashes: string[] = [];
      let skippedL2Count = 0;

      for (const { l2Node, l3Nodes } of candidates) {
        const remoteL2Id = nameToRemoteId.get(l2Node.name);
        if (remoteL2Id === undefined) {
          skippedL2Count++;
          continue;
        }

        for (const l3 of l3Nodes) {
          if (l3.content_hash && syncedHashes.has(l3.content_hash)) continue;

          events.push({
            type: "CREATE_L3",
            payload: {
              l2NodeId: remoteL2Id,
              title: l3.title,
              content: l3.content,
              nodeType: l3.node_type as SyncPushEvent["payload"]["nodeType"],
              confidence: l3.confidence,
              sourceCommits: l3.source_commits ? JSON.parse(l3.source_commits) : undefined,
              contentHash: l3.content_hash,
            },
          });

          if (l3.content_hash) newlySyncedHashes.push(l3.content_hash);
        }
      }

      if (events.length === 0) {
        const message = SYNC_MESSAGES.NOTHING_NEW(skippedL2Count);
        const result: SyncResult = { synced: 0, skipped: skippedL2Count, message };
        await appendSyncLogLine(workspaceRoot, { event: "sync.summary", projectId, ...result });
        return result;
      }

      let pushResult;
      try {
        pushResult = await remoteSyncClient.pushSyncEvents(projectId, events);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await appendSyncLogLine(workspaceRoot, { event: "sync.error", projectId, message });
        throw err;
      }

      projectState.syncedContentHashes = Array.from(new Set([...syncedHashes, ...newlySyncedHashes]));
      syncState[projectId] = projectState;
      await saveSyncState(workspaceRoot, syncState);

      const synced = pushResult.processed ?? events.length;
      const message = SYNC_MESSAGES.SYNCED(synced, skippedL2Count);
      const result: SyncResult = { synced, skipped: skippedL2Count, message };
      await appendSyncLogLine(workspaceRoot, { event: "sync.summary", projectId, ...result });
      return result;
    } finally {
      await store.close();
    }
  }
}
