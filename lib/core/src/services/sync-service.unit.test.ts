import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { SyncService } from "./sync-service.js";
import { IWorkspaceGitService } from "../interfaces/workspace-git.interfaces.js";
import { LOCAL_DB_NOT_FOUND_MESSAGE } from "./status-service.js";

const API_URL = "http://localhost:3000";
const PAT = "test-pat-token";
const PROJECT_ID = "42";

function makeWorkspaceGitMock(overrides: Partial<IWorkspaceGitService> = {}): IWorkspaceGitService {
  return {
    isGitRepository: vi.fn(),
    ensureKnowledgeBranch: vi.fn(),
    installPostCommitHook: vi.fn(),
    listTrackedFilesWithBlobHash: vi.fn(),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn(),
    getRemoteUrl: vi.fn(),
    getRecentChangedFilePaths: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    getChangedFilesSince: vi.fn(),
    getFilesChangedByCommit: vi.fn(),
    ...overrides,
  };
}

function seedLocalDb(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE l2_nodes (id INTEGER PRIMARY KEY, name TEXT, path_patterns TEXT);
    CREATE TABLE l3_nodes (
      id INTEGER PRIMARY KEY,
      l2_node_id INTEGER,
      title TEXT,
      content TEXT,
      node_type TEXT,
      confidence REAL,
      source_commits TEXT,
      content_hash TEXT
    );
  `);

  db.prepare("INSERT INTO l2_nodes (id, name, path_patterns) VALUES (?, ?, ?)").run(
    1,
    "moduleA",
    JSON.stringify(["src/a.ts"])
  );
  db.prepare("INSERT INTO l2_nodes (id, name, path_patterns) VALUES (?, ?, ?)").run(
    2,
    "moduleB-local-only",
    JSON.stringify(["src/b.ts"])
  );

  db.prepare(
    "INSERT INTO l3_nodes (id, l2_node_id, title, content, node_type, confidence, source_commits, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(1, 1, "Decision 1", "Body 1", "decision", 0.9, JSON.stringify(["abc123"]), "hash-new");
  db.prepare(
    "INSERT INTO l3_nodes (id, l2_node_id, title, content, node_type, confidence, source_commits, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    2,
    1,
    "Decision 2 (already synced)",
    "Body 2",
    "decision",
    0.8,
    JSON.stringify([]),
    "hash-already-synced"
  );
  db.prepare(
    "INSERT INTO l3_nodes (id, l2_node_id, title, content, node_type, confidence, source_commits, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    3,
    2,
    "Decision for unmatched module",
    "Body 3",
    "decision",
    0.7,
    JSON.stringify([]),
    "hash-unmatched"
  );

  db.close();
}

function seedSyncState(workspaceRoot: string, hashes: string[]): void {
  const statePath = path.join(workspaceRoot, ".docuvia", "logs", "sync-state.json");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify({ [PROJECT_ID]: { syncedContentHashes: hashes } }, null, 2)
  );
}

function readSyncState(workspaceRoot: string): any {
  const statePath = path.join(workspaceRoot, ".docuvia", "logs", "sync-state.json");
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

describe("SyncService.sync", () => {
  let tmpDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-sync-service-test-"));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("reports 'nothing to sync' and makes no network call when there are no changed files", async () => {
    const workspaceGit = makeWorkspaceGitMock();
    const service = new SyncService(tmpDir, API_URL, PAT, () => {}, workspaceGit);

    const result = await service.sync(PROJECT_ID);

    expect(result.synced).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws LOCAL_DB_NOT_FOUND_MESSAGE when local.db is missing but files changed", async () => {
    const workspaceGit = makeWorkspaceGitMock({
      listModifiedFiles: vi.fn().mockResolvedValue(["src/a.ts"]),
    });
    const service = new SyncService(tmpDir, API_URL, PAT, () => {}, workspaceGit);

    await expect(service.sync(PROJECT_ID)).rejects.toThrow(LOCAL_DB_NOT_FOUND_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves remote L2 ids by name, excludes already-synced content hashes, skips unmatched L2 nodes, and posts CREATE_L3 events to /sync/push", async () => {
    seedLocalDb(path.join(tmpDir, ".docuvia", "local.db"));
    seedSyncState(tmpDir, ["hash-already-synced"]);

    const workspaceGit = makeWorkspaceGitMock({
      listModifiedFiles: vi.fn().mockResolvedValue(["src/a.ts", "src/b.ts"]),
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { id: 501, name: "moduleA" },
          { id: 502, name: "some-other-module" },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, processed: 1 }),
      });

    const service = new SyncService(tmpDir, API_URL, PAT, () => {}, workspaceGit);
    const result = await service.sync(PROJECT_ID);

    // First call: GET the remote L2 node list.
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${API_URL}/projects/${PROJECT_ID}/l2-nodes`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${PAT}` }),
      })
    );

    // Second call: POST the outbox events to /sync/push (not the OpenAPI spec's bare /sync).
    const secondCallArgs = fetchMock.mock.calls[1];
    expect(secondCallArgs[0]).toBe(`${API_URL}/sync/push`);
    expect(secondCallArgs[1].method).toBe("POST");
    expect(secondCallArgs[1].headers.Authorization).toBe(`Bearer ${PAT}`);
    expect(secondCallArgs[1].headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(secondCallArgs[1].body);
    expect(body.projectId).toBe(Number(PROJECT_ID));
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toEqual({
      type: "CREATE_L3",
      payload: {
        l2NodeId: 501, // remote id, resolved by name match — NOT the local id (1)
        title: "Decision 1",
        content: "Body 1",
        nodeType: "decision",
        confidence: 0.9,
        sourceCommits: ["abc123"],
        contentHash: "hash-new",
      },
    });

    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(1); // moduleB-local-only had no remote-name match

    const syncState = readSyncState(tmpDir);
    expect(syncState[PROJECT_ID].syncedContentHashes.sort()).toEqual(
      ["hash-already-synced", "hash-new"].sort()
    );
  });

  it("rejects when the POST to /sync/push returns a non-ok response", async () => {
    seedLocalDb(path.join(tmpDir, ".docuvia", "local.db"));
    seedSyncState(tmpDir, []);

    const workspaceGit = makeWorkspaceGitMock({
      listModifiedFiles: vi.fn().mockResolvedValue(["src/a.ts"]),
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 501, name: "moduleA" }],
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Sync failed: boom" }),
      });

    const service = new SyncService(tmpDir, API_URL, PAT, () => {}, workspaceGit);

    await expect(service.sync(PROJECT_ID)).rejects.toThrow(/boom/);

    // The failed push must not have recorded any hashes as synced.
    const syncState = readSyncState(tmpDir);
    expect(syncState[PROJECT_ID].syncedContentHashes).toEqual([]);
  });
});
