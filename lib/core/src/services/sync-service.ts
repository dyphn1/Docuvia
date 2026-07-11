import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";
import { WorkspaceGitService } from "./workspace-git.service.js";
import { IWorkspaceGitService } from "../interfaces/workspace-git.interfaces.js";
import { LOCAL_DB_NOT_FOUND_MESSAGE } from "./status-service.js";
import { DOCUVIA_DIR_NAME, DOCUVIA_LOGS_DIR_NAME, SYNC_LOG_FILE_NAME } from "../constants/paths.js";
import { appendCommandLogLine } from "./command-log-writer.js";

export const SYNC_STATE_FILE_NAME = "sync-state.json";

export interface RemoteL2NodeSummary {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface CreateL3EventPayload {
  l2NodeId: number;
  title: string;
  content?: string | null;
  nodeType?: "change" | "rule" | "decision" | "context";
  confidence?: number | null;
  sourceCommits?: string[];
  contentHash?: string | null;
}

export interface SyncPushEvent {
  type: "CREATE_L3";
  payload: CreateL3EventPayload;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  message: string;
}

interface SyncStateFile {
  [projectId: string]: { syncedContentHashes: string[] };
}

interface LocalL2NodeRow {
  id: number;
  name: string;
  path_patterns: string | null;
}

interface LocalL3NodeRow {
  id: number;
  l2_node_id: number;
  title: string;
  content: string | null;
  node_type: string;
  confidence: number | null;
  source_commits: string | null;
  content_hash: string | null;
}

export class SyncService {
  constructor(
    private workspaceRoot: string = process.cwd(),
    private apiUrl: string = "",
    private pat: string = "",
    private logCallback: (msg: string) => void = () => {},
    private workspaceGit: IWorkspaceGitService = new WorkspaceGitService()
  ) {}

  private getDbPath(): string {
    return path.join(this.workspaceRoot, ".docuvia", "local.db");
  }

  private getSyncStatePath(): string {
    return path.join(
      this.workspaceRoot,
      DOCUVIA_DIR_NAME,
      DOCUVIA_LOGS_DIR_NAME,
      SYNC_STATE_FILE_NAME
    );
  }

  private async loadSyncState(): Promise<SyncStateFile> {
    try {
      const raw = await fsPromises.readFile(this.getSyncStatePath(), "utf8");
      return JSON.parse(raw) as SyncStateFile;
    } catch {
      return {};
    }
  }

  private async saveSyncState(state: SyncStateFile): Promise<void> {
    const statePath = this.getSyncStatePath();
    await fsPromises.mkdir(path.dirname(statePath), { recursive: true });
    await fsPromises.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
  }

  private async parseErrorBody(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: string };
      return body.error ?? res.statusText;
    } catch {
      return res.statusText;
    }
  }

  public async sync(projectId: string, commitSha?: string): Promise<SyncResult> {
    this.logCallback(`Starting sync for project ${projectId}...`);
    logger.info({ projectId, commitSha }, "Syncing to remote");
    await appendCommandLogLine(this.workspaceRoot, SYNC_LOG_FILE_NAME, {
      event: "sync.start",
      projectId,
      commitSha: commitSha ?? null,
    }).catch(() => {});

    const changedFiles = commitSha
      ? await this.workspaceGit.getFilesChangedByCommit(this.workspaceRoot, commitSha)
      : [
          ...(await this.workspaceGit.listModifiedFiles(this.workspaceRoot)),
          ...(await this.workspaceGit.listUntrackedFiles(this.workspaceRoot)),
        ];

    const changedFilesSet = new Set(changedFiles.filter(Boolean));
    if (changedFilesSet.size === 0) {
      const message = "Nothing to sync: no changed files detected.";
      this.logCallback(message);
      logger.info({ projectId }, message);
      await appendCommandLogLine(this.workspaceRoot, SYNC_LOG_FILE_NAME, {
        event: "sync.summary",
        projectId,
        synced: 0,
        skipped: 0,
        message,
      }).catch(() => {});
      return { synced: 0, skipped: 0, message };
    }

    if (!fs.existsSync(this.getDbPath())) {
      await appendCommandLogLine(this.workspaceRoot, SYNC_LOG_FILE_NAME, {
        event: "sync.error",
        projectId,
        message: LOCAL_DB_NOT_FOUND_MESSAGE,
      }).catch(() => {});
      throw new Error(LOCAL_DB_NOT_FOUND_MESSAGE);
    }

    const l2ListRes = await fetch(`${this.apiUrl}/projects/${projectId}/l2-nodes`, {
      headers: { Authorization: `Bearer ${this.pat}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!l2ListRes.ok) {
      const message = await this.parseErrorBody(l2ListRes);
      logger.warn(
        { projectId, status: l2ListRes.status },
        `Failed to fetch remote L2 nodes: ${message}`
      );
      await appendCommandLogLine(this.workspaceRoot, SYNC_LOG_FILE_NAME, {
        event: "sync.error",
        projectId,
        message: `Failed to fetch remote L2 nodes: ${message}`,
      }).catch(() => {});
      throw new Error(`Failed to fetch remote L2 nodes: ${message}`);
    }
    const remoteL2Nodes = (await l2ListRes.json()) as RemoteL2NodeSummary[];
    const nameToRemoteId = new Map(remoteL2Nodes.map((n) => [n.name, n.id]));

    const candidates = this.readLocalCandidates(changedFilesSet);
    const candidateL2Nodes = candidates.candidateL2Nodes;
    const l3ByL2 = candidates.l3ByL2;

    const syncState = await this.loadSyncState();
    const projectState = syncState[projectId] ?? { syncedContentHashes: [] };
    const syncedHashes = new Set(projectState.syncedContentHashes);

    const events: SyncPushEvent[] = [];
    const newlySyncedHashes: string[] = [];
    let skippedL2Count = 0;

    for (const l2 of candidateL2Nodes) {
      const remoteL2Id = nameToRemoteId.get(l2.name);
      if (remoteL2Id === undefined) {
        skippedL2Count++;
        logger.warn(
          { l2Name: l2.name, projectId },
          "Skipping local L2 node with no matching remote L2 node (partial-bootstrap project)"
        );
        continue;
      }

      const l3Nodes = l3ByL2.get(l2.id) ?? [];
      for (const l3 of l3Nodes) {
        if (l3.content_hash && syncedHashes.has(l3.content_hash)) {
          continue;
        }

        events.push({
          type: "CREATE_L3",
          payload: {
            l2NodeId: remoteL2Id,
            title: l3.title,
            content: l3.content,
            nodeType: (l3.node_type as CreateL3EventPayload["nodeType"]) ?? undefined,
            confidence: l3.confidence,
            sourceCommits: l3.source_commits ? JSON.parse(l3.source_commits) : undefined,
            contentHash: l3.content_hash,
          },
        });

        if (l3.content_hash) newlySyncedHashes.push(l3.content_hash);
      }
    }

    if (events.length === 0) {
      const message = `Nothing new to sync (${skippedL2Count} module(s) skipped, no remote match).`;
      this.logCallback(message);
      logger.info({ projectId, skippedL2Count }, message);
      await appendCommandLogLine(this.workspaceRoot, SYNC_LOG_FILE_NAME, {
        event: "sync.summary",
        projectId,
        synced: 0,
        skipped: skippedL2Count,
        message,
      }).catch(() => {});
      return { synced: 0, skipped: skippedL2Count, message };
    }

    const pushRes = await fetch(`${this.apiUrl}/sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.pat}`,
      },
      body: JSON.stringify({ projectId: Number(projectId), events }),
      signal: AbortSignal.timeout(30000),
    });

    if (!pushRes.ok) {
      const message = await this.parseErrorBody(pushRes);
      logger.warn({ projectId, status: pushRes.status }, `Sync push failed: ${message}`);
      await appendCommandLogLine(this.workspaceRoot, SYNC_LOG_FILE_NAME, {
        event: "sync.error",
        projectId,
        message: `Sync push failed: ${message}`,
      }).catch(() => {});
      throw new Error(`Sync push failed: ${message}`);
    }

    const result = (await pushRes.json()) as { success: boolean; processed: number };

    projectState.syncedContentHashes = Array.from(new Set([...syncedHashes, ...newlySyncedHashes]));
    syncState[projectId] = projectState;
    await this.saveSyncState(syncState);

    const synced = result.processed ?? events.length;
    const message = `Synced ${synced} decision(s), ${skippedL2Count} module(s) skipped.`;
    this.logCallback(message);
    logger.info({ projectId, synced, skippedL2Count }, message);
    await appendCommandLogLine(this.workspaceRoot, SYNC_LOG_FILE_NAME, {
      event: "sync.summary",
      projectId,
      synced,
      skipped: skippedL2Count,
      message,
    }).catch(() => {});

    return { synced, skipped: skippedL2Count, message };
  }

  private readLocalCandidates(changedFilesSet: Set<string>): {
    candidateL2Nodes: LocalL2NodeRow[];
    l3ByL2: Map<number, LocalL3NodeRow[]>;
  } {
    const db = new Database(this.getDbPath(), { readonly: true });
    try {
      const allL2Nodes = db
        .prepare("SELECT id, name, path_patterns FROM l2_nodes")
        .all() as LocalL2NodeRow[];

      const candidateL2Nodes = allL2Nodes.filter((node) => {
        if (!node.path_patterns) return false;
        try {
          const patterns: string[] = JSON.parse(node.path_patterns);
          return patterns.some((p) => changedFilesSet.has(p));
        } catch {
          return false;
        }
      });

      const l3Stmt = db.prepare(
        "SELECT id, l2_node_id, title, content, node_type, confidence, source_commits, content_hash FROM l3_nodes WHERE l2_node_id = ?"
      );

      const l3ByL2 = new Map<number, LocalL3NodeRow[]>();
      for (const l2 of candidateL2Nodes) {
        l3ByL2.set(l2.id, l3Stmt.all(l2.id) as LocalL3NodeRow[]);
      }

      return { candidateL2Nodes, l3ByL2 };
    } finally {
      db.close();
    }
  }
}
