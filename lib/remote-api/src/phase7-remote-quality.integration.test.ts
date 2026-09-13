import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
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

describe("Phase 7 FetchRemoteSyncClient contract quality", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
  });

  it("preserves extra remote node fields while validating required id/name fields", async () => {
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

  it("rejects valid JSON with wrong required remote-node field types", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ id: "7", name: 42 }]));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "phase7-pat" });

    await expect(client.fetchRemoteL2Nodes("42")).rejects.toMatchObject({
      code: "SYNC_FETCH_FAILED",
      message: expect.stringContaining(
        "did not match the remote-node contract",
      ),
    });
  });

  it("rejects valid JSON with wrong required sync-push result types", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: "yes", processed: 1 }));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "phase7-pat" });

    await expect(client.pushSyncEvents("42", [])).rejects.toMatchObject({
      code: "SYNC_PUSH_FAILED",
      message: expect.stringContaining("did not match the sync-push contract"),
    });
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
});
