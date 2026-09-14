import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { FetchRemoteSyncClient } from "./fetch-remote-sync-client.js";

// TDD-SOURCE: lib/contracts/src/interfaces/remote-sync.interfaces.ts#IRemoteSyncClient

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function captureDocuviaError(
  promise: Promise<unknown>,
): Promise<DocuviaError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DocuviaError) return error;
    throw error;
  }
  throw new Error("Expected DocuviaError");
}

describe("Phase 7 FetchRemoteSyncClient contract quality", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
  });

  it("[happy] preserves extra remote node fields while validating required id/name fields", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify([
          { id: 7, name: "src/a.ts", revision: "abc123", score: 0.9 },
        ]),
      );
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "phase7-pat" });

    await expect(client.fetchRemoteL2Nodes("42")).resolves.toEqual([
      { id: 7, name: "src/a.ts", revision: "abc123", score: 0.9 },
    ]);
  });

  it("[invalid-input] rejects valid JSON with wrong required remote-node field types", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ id: "7", name: 42 }]));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "phase7-pat" });

    const error = await captureDocuviaError(client.fetchRemoteL2Nodes("42"));
    expect(error.code).toBe(ErrorCodes.SYNC_FETCH_FAILED);
    expect(
      error.message.startsWith(
        "Failed to fetch remote L2 nodes: response body did not match the remote-node contract",
      ),
    ).toBe(true);
  });

  it("rejects valid JSON with wrong required sync-push result types", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: "yes", processed: 1 }));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "phase7-pat" });

    const error = await captureDocuviaError(client.pushSyncEvents("42", []));
    expect(error.code).toBe(ErrorCodes.SYNC_PUSH_FAILED);
    expect(
      error.message.startsWith(
        "Sync push failed: response body did not match the sync-push contract",
      ),
    ).toBe(true);
  });

  it("[error-handling] preserves an exact remote HTTP failure reason and error code", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "maintenance-window" }));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "phase7-pat" });

    const error = await captureDocuviaError(client.fetchRemoteL2Nodes("42"));
    expect(error.code).toBe(ErrorCodes.SYNC_FETCH_FAILED);
    expect(error.message).toBe(
      "Failed to fetch remote L2 nodes: maintenance-window",
    );
  });

  it("returns identical validated remote results across repeated identical input", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ id: 1, name: "src/stable.ts" }]));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "phase7-pat" });

    const first = await client.fetchRemoteL2Nodes("42");
    const second = await client.fetchRemoteL2Nodes("42");

    expect(second).toEqual(first);
  });

  it("[state-diff] observes remote node-set changes instead of serving stale cached state", async () => {
    let remoteNodes = [{ id: 1, name: "src/one.ts", revision: "r1" }];
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(remoteNodes));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "phase7-pat" });

    const before = await client.fetchRemoteL2Nodes("42");
    expect(before).toEqual([{ id: 1, name: "src/one.ts", revision: "r1" }]);

    remoteNodes = [
      { id: 1, name: "src/one.ts", revision: "r1" },
      { id: 2, name: "src/two.ts", revision: "r2" },
    ];

    const after = await client.fetchRemoteL2Nodes("42");
    expect(after).toEqual(remoteNodes);
    expect(after).not.toEqual(before);
  });

  it("[stress] preserves all 250 remote nodes and repeated-read determinism", async () => {
    const expected = Array.from({ length: 250 }, (_, index) => ({
      id: index + 1,
      name: `src/stress-${index.toString().padStart(3, "0")}.ts`,
      revision: `rev-${index.toString().padStart(3, "0")}`,
      score: index / 250,
    }));
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(expected));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "phase7-pat" });

    const first = await client.fetchRemoteL2Nodes("42");
    const second = await client.fetchRemoteL2Nodes("42");

    expect(first).toEqual(expected);
    expect(second).toEqual(first);
    expect(new Set(first.map((node) => node.id)).size).toBe(250);
    expect(new Set(first.map((node) => node.name)).size).toBe(250);
  });
});
