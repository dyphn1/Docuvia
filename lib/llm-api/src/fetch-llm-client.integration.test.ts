import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { DocuviaError } from "@workspace/contracts";
import { FetchLlmClient } from "./fetch-llm-client.js";

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
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

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

describe("FetchLlmClient (integration, real HTTP over loopback)", () => {
  let close: () => Promise<void>;

  afterEach(async () => {
    if (close) await close();
  });

  it("chatCompletion POSTs to /v1/chat/completions with the mapped body and a Bearer auth header, and returns the parsed camelCased result", async () => {
    let receivedPath: string | undefined;
    let receivedAuth: string | undefined;
    let receivedBody = "";
    const server = await startServer(async (req, res) => {
      receivedPath = req.url;
      receivedAuth = req.headers.authorization;
      receivedBody = await readBody(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-1",
          model: "gpt-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "hi" },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "secret-key" });

    const result = await client.chatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(receivedPath).toBe("/v1/chat/completions");
    expect(receivedAuth).toBe("Bearer secret-key");
    expect(JSON.parse(receivedBody)).toEqual({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
    expect(result).toEqual({
      id: "chatcmpl-1",
      model: "gpt-test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hi" },
          finishReason: "stop",
        },
      ],
    });
  });

  it("chatCompletion omits the Authorization header when no apiKey is configured", async () => {
    let receivedAuth: string | undefined;
    const server = await startServer((req, res) => {
      receivedAuth = req.headers.authorization;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-1",
          model: "gpt-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "hi" },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url });

    await client.chatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(receivedAuth).toBeUndefined();
  });

  it("chatCompletion throws LLM_AUTH_FAILED for a 401 response (issue #134 error classification)", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "bad-key" });

    await expect(
      client.chatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
      code: "LLM_AUTH_FAILED",
      message: expect.stringContaining("unauthorized"),
    });
  });

  it("chatCompletion throws LLM_CHAT_COMPLETION_FAILED for a 500 response (issue #134 error classification)", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "secret-key" });

    await expect(
      client.chatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
      code: "LLM_CHAT_COMPLETION_FAILED",
      message: expect.stringContaining("internal error"),
    });
  });

  it("chatCompletion throws a DocuviaError (not a raw SyntaxError) on a 200 response with a non-JSON body", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>not json, e.g. a misconfigured proxy</html>");
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "secret-key" });

    await expect(
      client.chatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toBeInstanceOf(DocuviaError);
    await expect(
      client.chatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
      code: "LLM_CHAT_COMPLETION_FAILED",
      message: expect.stringContaining("not valid JSON"),
    });
  });

  it("streamChatCompletion yields parsed, camelCased chunks from an SSE response and stops cleanly at [DONE]", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        "data: " +
          JSON.stringify({
            id: "chatcmpl-1",
            model: "gpt-test",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "hel" },
                finish_reason: null,
              },
            ],
          }) +
          "\n\n",
      );
      res.write(
        "data: " +
          JSON.stringify({
            id: "chatcmpl-1",
            model: "gpt-test",
            choices: [
              {
                index: 0,
                delta: { content: "lo" },
                finish_reason: "stop",
              },
            ],
          }) +
          "\n\n",
      );
      res.write("data: [DONE]\n\n");
      res.end();
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "secret-key" });

    const chunks = [];
    for await (const chunk of client.streamChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        id: "chatcmpl-1",
        model: "gpt-test",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "hel" },
            finishReason: null,
          },
        ],
      },
      {
        id: "chatcmpl-1",
        model: "gpt-test",
        choices: [
          {
            index: 0,
            delta: { content: "lo" },
            finishReason: "stop",
          },
        ],
      },
    ]);
  });

  it("streamChatCompletion throws a DocuviaError with LLM_CHAT_COMPLETION_FAILED on a non-2xx response", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "secret-key" });

    await expect(async () => {
      for await (const _chunk of client.streamChatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      })) {
        // no-op
      }
    }).rejects.toMatchObject({
      code: "LLM_CHAT_COMPLETION_FAILED",
      message: expect.stringContaining("internal error"),
    });
  });
});
