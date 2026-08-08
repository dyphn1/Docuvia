import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  SyncPushEventTypes,
  type ILogger,
  type L2NodeWithL3Children,
  type SyncPushEvent,
} from "@workspace/contracts";
import { SYNC_EVENTS, SYNC_MESSAGES } from "./sync-messages.js";
import { appendSyncLogLine } from "./sync-log-writer.js";
import {
  loadSyncState,
  saveSyncState,
  withSyncStateLock,
} from "./sync-state.js";
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
    private readonly pat: string,
  ) {}

  public async execute(input: {
    projectId: string;
    commitSha?: string;
  }): Promise<SyncResult> {
    const { workspaceRoot, logger } = this;
    const { projectId, commitSha } = input;

    logger.info(SYNC_MESSAGES.STARTING(projectId));
    await appendSyncLogLine(workspaceRoot, {
      event: SYNC_EVENTS.START,
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
      const result: SyncResult = {
        synced: 0,
        skipped: 0,
        message: SYNC_MESSAGES.NOTHING_TO_SYNC,
      };
      await appendSyncLogLine(workspaceRoot, {
        event: SYNC_EVENTS.SUMMARY,
        projectId,
        ...result,
      });
      return result;
    }

    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    let store;
    try {
      store = await openStore({
        dbPath: resolveDbPath(workspaceRoot),
        readonly: true,
      });
    } catch (err) {
      if (
        err instanceof DocuviaError &&
        err.code === ErrorCodes.DB_NOT_FOUND
      ) {
        await appendSyncLogLine(workspaceRoot, {
          event: SYNC_EVENTS.ERROR,
          projectId,
          message: SYNC_MESSAGES.DB_NOT_FOUND,
        });
        throw new DocuviaError(
          ErrorCodes.DB_NOT_FOUND,
          SYNC_MESSAGES.DB_NOT_FOUND,
          err,
        );
      }
      throw err;
    }

    try {
      const buildRemoteSyncClient = docuviaFactory.resolve(
        TOKENS.RemoteSyncClient,
      );
      const remoteSyncClient = buildRemoteSyncClient();
      remoteSyncClient.initialize({ apiUrl: this.apiUrl, pat: this.pat });

      let remoteL2Nodes;
      try {
        remoteL2Nodes = await remoteSyncClient.fetchRemoteL2Nodes(projectId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await appendSyncLogLine(workspaceRoot, {
          event: SYNC_EVENTS.ERROR,
          projectId,
          message,
        });
        throw err;
      }
      const nameToRemoteId = new Map(remoteL2Nodes.map((n) => [n.name, n.id]));

      const candidates = store.graph.findNodesForChangedFiles(
        Array.from(changedFilesSet),
      );

      // The load→mutate→save cycle below races against any other `docuvia publish` process
      // touching the same workspace's sync-state.json — held for the push call too, since the
      // decision of what's "newly synced" is only valid under the lock that guards the save.
      const result = await withSyncStateLock(
        workspaceRoot,
        async (): Promise<SyncResult> => {
          const syncState = await loadSyncState(workspaceRoot);
          const projectState = syncState[projectId] ?? {
            syncedContentHashes: [],
          };
          const syncedHashes = new Set(projectState.syncedContentHashes);

          const { events, newlySyncedHashes, skippedL2Count } =
            this.buildSyncPushEvents(candidates, nameToRemoteId, syncedHashes);

          if (events.length === 0) {
            return {
              synced: 0,
              skipped: skippedL2Count,
              message: SYNC_MESSAGES.NOTHING_NEW(skippedL2Count),
            };
          }

          let pushResult;
          try {
            pushResult = await remoteSyncClient.pushSyncEvents(
              projectId,
              events,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await appendSyncLogLine(workspaceRoot, {
              event: SYNC_EVENTS.ERROR,
              projectId,
              message,
            });
            throw err;
          }

          projectState.syncedContentHashes = Array.from(
            new Set([...syncedHashes, ...newlySyncedHashes]),
          );
          syncState[projectId] = projectState;
          await saveSyncState(workspaceRoot, syncState);

          const synced = pushResult.processed ?? events.length;
          return {
            synced,
            skipped: skippedL2Count,
            message: SYNC_MESSAGES.SYNCED(synced, skippedL2Count),
          };
        },
      );

      await appendSyncLogLine(workspaceRoot, {
        event: SYNC_EVENTS.SUMMARY,
        projectId,
        ...result,
      });
      return result;
    } finally {
      await store.close();
    }
  }

  /**
   * Builds the `CREATE_L3` push events for `candidates` — skipping L2 nodes with no matching
   * remote id and L3 nodes already covered by `syncedHashes` — the event-construction core of
   * `execute`'s `withSyncStateLock` callback.
   */
  private buildSyncPushEvents(
    candidates: L2NodeWithL3Children[],
    nameToRemoteId: Map<string, number>,
    syncedHashes: Set<string>,
  ): {
    events: SyncPushEvent[];
    newlySyncedHashes: string[];
    skippedL2Count: number;
  } {
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

        events.push(this.buildL3PushEvent(remoteL2Id, l3));
        if (l3.content_hash) newlySyncedHashes.push(l3.content_hash);
      }
    }

    return { events, newlySyncedHashes, skippedL2Count };
  }

  /** Builds a single `CREATE_L3` push event payload for `l3`, attributed to `l2NodeId`. */
  private buildL3PushEvent(
    l2NodeId: number,
    l3: L2NodeWithL3Children["l3Nodes"][number],
  ): SyncPushEvent {
    return {
      type: SyncPushEventTypes.CREATE_L3,
      payload: {
        l2NodeId,
        title: l3.title,
        content: l3.content,
        nodeType: l3.node_type as SyncPushEvent["payload"]["nodeType"],
        confidence: l3.confidence,
        sourceCommits: l3.source_commits
          ? JSON.parse(l3.source_commits)
          : undefined,
        contentHash: l3.content_hash,
      },
    };
  }
}
