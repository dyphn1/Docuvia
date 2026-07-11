import fs from "fs/promises";
import path from "path";
import { DOCUVIA_DIR_NAME, DOCUVIA_LOGS_DIR_NAME, SYNC_STATE_FILE_NAME } from "@workspace/contracts";

export interface SyncStateFile {
  [projectId: string]: { syncedContentHashes: string[] };
}

function resolveSyncStatePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, DOCUVIA_DIR_NAME, DOCUVIA_LOGS_DIR_NAME, SYNC_STATE_FILE_NAME);
}

/** Content-hash dedup cache so re-running `sync` doesn't re-push already-synced L3 decisions. Missing/corrupt file reads as empty state rather than throwing — a fresh workspace has no cache yet. */
export async function loadSyncState(workspaceRoot: string): Promise<SyncStateFile> {
  try {
    const raw = await fs.readFile(resolveSyncStatePath(workspaceRoot), "utf8");
    return JSON.parse(raw) as SyncStateFile;
  } catch {
    return {};
  }
}

export async function saveSyncState(workspaceRoot: string, state: SyncStateFile): Promise<void> {
  const statePath = resolveSyncStatePath(workspaceRoot);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}
