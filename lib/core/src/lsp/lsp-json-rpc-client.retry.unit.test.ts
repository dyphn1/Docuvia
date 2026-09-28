import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LspErrorCodes, LspRequestRetryConstants } from "./lsp-constants.js";
import { LspJsonRpcClient } from "./lsp-json-rpc-client.js";

const INTERNAL_ERROR_CODE = -32603;
const RETRY_SETTLE_WAIT_MS = 100;
const REQUEST_TIMEOUT_MS = 10;

interface JsonRpcRequest {
  id: number;
  method: string;
  params: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface FakeLspServerApi {
  send(response: JsonRpcResponse): void;
}

type FakeResponseHandler = (
  request: JsonRpcRequest,
  server: FakeLspServerApi,
) => void;

class FakeLspServer {
  readonly requests: JsonRpcRequest[] = [];
  private buffer = Buffer.alloc(0);

  constructor(
    private readonly input: PassThrough,
    private readonly output: PassThrough,
    private readonly responseHandler: FakeResponseHandler,
  ) {
    input.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });
  }

  send(response: JsonRpcResponse): void {
    const payload = JSON.stringify(response);
    const header = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n`;
    this.output.write(header + payload, "utf8");
  }

  private processBuffer(): void {
    for (;;) {
      const separatorIndex = this.buffer.indexOf("\r\n\r\n");
      if (separatorIndex === -1) return;

      const headerEnd = separatorIndex + "\r\n\r\n".length;
      const header = this.buffer.subarray(0, separatorIndex).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd);
        continue;
      }

      const bodyLength = Number(match[1]);
      if (this.buffer.length < headerEnd + bodyLength) return;

      const body = this.buffer
        .subarray(headerEnd, headerEnd + bodyLength)
        .toString("utf8");
      this.buffer = this.buffer.subarray(headerEnd + bodyLength);
      const request = JSON.parse(body) as JsonRpcRequest;
      this.requests.push(request);
      this.responseHandler(request, this);
    }
  }
}

function createFakeClient(responseHandler: FakeResponseHandler): {
  client: LspJsonRpcClient;
  server: FakeLspServer;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  Object.assign(child, {
    stdin: input,
    stdout: output,
    stderr,
    kill: () => true,
    unref: () => undefined,
  });

  const client = new LspJsonRpcClient();
  const internals = client as unknown as {
    child: ChildProcessWithoutNullStreams | undefined;
    stopped: boolean;
    onData: (chunk: Buffer) => void;
  };
  internals.child = child;
  internals.stopped = false;
  output.on("data", (chunk: Buffer) => internals.onData.call(client, chunk));

  return { client, server: new FakeLspServer(input, output, responseHandler) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LspJsonRpcClient transient JSON-RPC errors", () => {
  it("[happy] retries ContentModified once and resolves with the result", async () => {
    vi.useFakeTimers();
    const { client, server } = createFakeClient((request, fakeServer) => {
      if (server.requests.length === 1) {
        fakeServer.send({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: LspErrorCodes.CONTENT_MODIFIED,
            message: "content modified",
          },
        });
        return;
      }
      fakeServer.send({
        jsonrpc: "2.0",
        id: request.id,
        result: { ok: true },
      });
    });

    try {
      const resultPromise = client.request<{ ok: boolean }>(
        "textDocument/references",
        { key: "content-modified" },
        RETRY_SETTLE_WAIT_MS,
      );
      await vi.advanceTimersByTimeAsync(RETRY_SETTLE_WAIT_MS);

      await expect(resultPromise).resolves.toEqual({ ok: true });
      expect(server.requests).toHaveLength(2);
      expect(server.requests[0].id).not.toBe(server.requests[1].id);
    } finally {
      await client.stop();
    }
  });

  it("[happy] retries ServerCancelled once and resolves with the result", async () => {
    vi.useFakeTimers();
    const { client, server } = createFakeClient((request, fakeServer) => {
      if (server.requests.length === 1) {
        fakeServer.send({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: LspErrorCodes.SERVER_CANCELLED,
            message: "server cancelled",
          },
        });
        return;
      }
      fakeServer.send({
        jsonrpc: "2.0",
        id: request.id,
        result: { retried: true },
      });
    });

    try {
      const resultPromise = client.request<{ retried: boolean }>(
        "textDocument/references",
        { key: "server-cancelled" },
        RETRY_SETTLE_WAIT_MS,
      );
      await vi.advanceTimersByTimeAsync(RETRY_SETTLE_WAIT_MS);

      await expect(resultPromise).resolves.toEqual({ retried: true });
      expect(server.requests).toHaveLength(2);
    } finally {
      await client.stop();
    }
  });

  it("[error-handling] rejects after the maximum attempts with ContentModified's code", async () => {
    vi.useFakeTimers();
    const { client, server } = createFakeClient((request, fakeServer) => {
      fakeServer.send({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: LspErrorCodes.CONTENT_MODIFIED,
          message: "still modified",
        },
      });
    });

    try {
      const resultPromise = client.request(
        "textDocument/references",
        { key: "always-modified" },
        RETRY_SETTLE_WAIT_MS,
      );
      const rejection = expect(resultPromise).rejects.toMatchObject({
        code: LspErrorCodes.CONTENT_MODIFIED,
        message: "still modified",
      });
      await vi.advanceTimersByTimeAsync(RETRY_SETTLE_WAIT_MS);

      await rejection;
      expect(server.requests).toHaveLength(
        LspRequestRetryConstants.MAX_ATTEMPTS,
      );
      expect(
        (client as unknown as { pending: Map<number, unknown> }).pending.size,
      ).toBe(0);
    } finally {
      await client.stop();
    }
  });

  it("[error-handling] rejects non-retriable errors after one request with its code", async () => {
    vi.useFakeTimers();
    const { client, server } = createFakeClient((request, fakeServer) => {
      fakeServer.send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: INTERNAL_ERROR_CODE, message: "internal failure" },
      });
    });

    try {
      const resultPromise = client.request(
        "textDocument/references",
        { key: "non-retriable" },
        RETRY_SETTLE_WAIT_MS,
      );

      await expect(resultPromise).rejects.toMatchObject({
        code: INTERNAL_ERROR_CODE,
        message: "internal failure",
      });
      expect(server.requests).toHaveLength(1);
    } finally {
      await client.stop();
    }
  });

  it("[error-handling] stops retrying when the overall request timeout elapses", async () => {
    vi.useFakeTimers();
    const { client, server } = createFakeClient((request, fakeServer) => {
      fakeServer.send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: LspErrorCodes.SERVER_CANCELLED, message: "try again" },
      });
    });

    try {
      const resultPromise = client.request(
        "textDocument/references",
        { key: "timeout" },
        REQUEST_TIMEOUT_MS,
      );
      const rejection = expect(resultPromise).rejects.toThrow(
        `timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

      await rejection;
      const requestCountAtTimeout = server.requests.length;
      await vi.advanceTimersByTimeAsync(RETRY_SETTLE_WAIT_MS);
      expect(server.requests).toHaveLength(requestCountAtTimeout);
      expect(
        (client as unknown as { pending: Map<number, unknown> }).pending.size,
      ).toBe(0);
    } finally {
      await client.stop();
    }
  });

  it("[stress] correlates a retried request with concurrent first-try successes", async () => {
    vi.useFakeTimers();
    const firstAttemptByKey = new Set<string>();
    const { client, server } = createFakeClient((request, fakeServer) => {
      const key = (request.params as { key: string }).key;
      if (key === "retry" && !firstAttemptByKey.has(key)) {
        firstAttemptByKey.add(key);
        fakeServer.send({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: LspErrorCodes.CONTENT_MODIFIED,
            message: "retry this one",
          },
        });
        return;
      }
      fakeServer.send({
        jsonrpc: "2.0",
        id: request.id,
        result: { key },
      });
    });

    try {
      const keys = ["first", "retry", "last"];
      const resultsPromise = Promise.all(
        keys.map((key) =>
          client.request<{ key: string }>(
            "textDocument/references",
            { key },
            RETRY_SETTLE_WAIT_MS,
          ),
        ),
      );
      await vi.advanceTimersByTimeAsync(RETRY_SETTLE_WAIT_MS);

      await expect(resultsPromise).resolves.toEqual(
        keys.map((key) => ({ key })),
      );
      expect(server.requests).toHaveLength(keys.length + 1);
      expect(new Set(server.requests.map((request) => request.id)).size).toBe(
        server.requests.length,
      );
      expect(
        (client as unknown as { pending: Map<number, unknown> }).pending.size,
      ).toBe(0);
    } finally {
      await client.stop();
    }
  });

  it("[invalid-input] treats an error object without a code as non-retriable", async () => {
    vi.useFakeTimers();
    const { client, server } = createFakeClient((request, fakeServer) => {
      fakeServer.send({
        jsonrpc: "2.0",
        id: request.id,
        error: { message: "missing code" },
      });
    });

    try {
      const resultPromise = client.request(
        "textDocument/references",
        { key: "missing-code" },
        RETRY_SETTLE_WAIT_MS,
      );

      await expect(resultPromise).rejects.toMatchObject({
        code: undefined,
        message: "missing code",
      });
      expect(server.requests).toHaveLength(1);
    } finally {
      await client.stop();
    }
  });
});
