import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { DocuviaError } from "@workspace/contracts";
import { FetchRemoteSyncClient } from "./fetch-remote-sync-client.js";

/** Minimal real HTTP server standing in for the remote Docuvia backend — real network I/O over
 *  loopback, matching this layer's "Isolated Integration Tests / Real I/O Required" rule (see
 *  docs/gitbook/architecture/testing-and-quality-architecture.md). */
function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

describe("FetchRemoteSyncClient (integration, real HTTP over loopback)", () => {
  let close: () => Promise<void>;

  afterEach(async () => {
    if (close) await close();
  });

  it("fetchRemoteL2Nodes GETs /projects/:id/l2-nodes with a Bearer token and parses the JSON response", async () => {
    let receivedPath: string | undefined;
    let receivedAuth: string | undefined;
    const server = await startServer((req, res) => {
      receivedPath = req.url;
      receivedAuth = req.headers.authorization;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ id: 1, name: "src/a.ts" }]));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "secret-pat" });

    const nodes = await client.fetchRemoteL2Nodes("42");

    expect(receivedPath).toBe("/projects/42/l2-nodes");
    expect(receivedAuth).toBe("Bearer secret-pat");
    expect(nodes).toEqual([{ id: 1, name: "src/a.ts" }]);
  });

  it("fetchRemoteL2Nodes throws a DocuviaError with SYNC_FETCH_FAILED on a non-2xx response", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "bad-pat" });

    await expect(client.fetchRemoteL2Nodes("42")).rejects.toMatchObject({
      code: "SYNC_FETCH_FAILED",
      message: expect.stringContaining("unauthorized"),
    });
    await expect(client.fetchRemoteL2Nodes("42")).rejects.toBeInstanceOf(DocuviaError);
  });

  it("pushSyncEvents POSTs to /sync/push with the events body and returns the parsed result", async () => {
    let receivedBody = "";
    const server = await startServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, processed: 1 }));
      });
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "secret-pat" });

    const result = await client.pushSyncEvents("42", [
      { type: "CREATE_L3", payload: { l2NodeId: 1, title: "a decision" } },
    ]);

    expect(result).toEqual({ success: true, processed: 1 });
    expect(JSON.parse(receivedBody)).toEqual({
      projectId: 42,
      events: [{ type: "CREATE_L3", payload: { l2NodeId: 1, title: "a decision" } }],
    });
  });

  it("pushSyncEvents throws a DocuviaError with SYNC_PUSH_FAILED on a non-2xx response", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "secret-pat" });

    await expect(client.pushSyncEvents("42", [])).rejects.toMatchObject({
      code: "SYNC_PUSH_FAILED",
      message: expect.stringContaining("internal error"),
    });
  });

  it("fetchRemoteL2Nodes throws a DocuviaError (not a raw SyntaxError) when a 200 response body isn't valid JSON", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>not json, e.g. a misconfigured proxy</html>");
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "secret-pat" });

    await expect(client.fetchRemoteL2Nodes("42")).rejects.toBeInstanceOf(DocuviaError);
    await expect(client.fetchRemoteL2Nodes("42")).rejects.toMatchObject({
      code: "SYNC_FETCH_FAILED",
      message: expect.stringContaining("not valid JSON"),
    });
  });

  it("pushSyncEvents throws a DocuviaError (not a raw SyntaxError) when a 200 response body isn't valid JSON", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>not json, e.g. a misconfigured proxy</html>");
    });
    close = server.close;

    const client = new FetchRemoteSyncClient();
    client.initialize({ apiUrl: server.url, pat: "secret-pat" });

    await expect(client.pushSyncEvents("42", [])).rejects.toBeInstanceOf(DocuviaError);
    await expect(client.pushSyncEvents("42", [])).rejects.toMatchObject({
      code: "SYNC_PUSH_FAILED",
      message: expect.stringContaining("not valid JSON"),
    });
  });
});
