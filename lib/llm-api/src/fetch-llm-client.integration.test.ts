import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { FetchLlmClient } from "./fetch-llm-client.js";

// TDD-SOURCE: lib/contracts/src/interfaces/llm-client.interfaces.ts#ILlmClient

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

describe("FetchLlmClient (integration, real HTTP over loopback)", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
  });

  it("[happy] chatCompletion POSTs the exact mapped body/auth header and returns the parsed camelCased result", async () => {
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

    expect(receivedAuth).toEqual(undefined);
  });

  it("[error-handling] chatCompletion preserves the exact 401 auth failure code and reason", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "bad-key" });

    const error = await captureDocuviaError(
      client.chatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      }),
    );
    expect(error.code).toBe(ErrorCodes.LLM_AUTH_FAILED);
    expect(error.message).toBe("Chat completion failed: unauthorized");
  });

  it("chatCompletion preserves the exact 500 HTTP failure code and reason", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "secret-key" });

    const error = await captureDocuviaError(
      client.chatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      }),
    );
    expect(error.code).toBe(ErrorCodes.LLM_HTTP_FAILED);
    expect(error.message).toBe("Chat completion failed: internal error");
  });

  it("[invalid-input] chatCompletion wraps a non-JSON 200 response instead of leaking SyntaxError", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>not json, e.g. a misconfigured proxy</html>");
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "secret-key" });

    const error = await captureDocuviaError(
      client.chatCompletion({
        model: "gpt-test",
        messages: [{ role: "user", content: "hello" }],
      }),
    );
    expect(error.code).toBe(ErrorCodes.LLM_INVALID_RESPONSE);
    expect(
      error.message.startsWith(
        "Chat completion failed: response body was not valid JSON",
      ),
    ).toBe(true);
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

  it("streamChatCompletion preserves the exact non-2xx failure contract", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "secret-key" });

    const error = await captureDocuviaError(
      (async () => {
        for await (const _chunk of client.streamChatCompletion({
          model: "gpt-test",
          messages: [{ role: "user", content: "hello" }],
        })) {
          // drain
        }
      })(),
    );
    expect(error.code).toBe(ErrorCodes.LLM_CHAT_COMPLETION_FAILED);
    expect(error.message).toBe("Chat completion stream failed: internal error");
  });

  it("[state-diff] reinitialize replaces the observable authorization state for subsequent requests", async () => {
    const receivedAuth: Array<string | undefined> = [];
    const server = await startServer((req, res) => {
      receivedAuth.push(req.headers.authorization);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-config",
          model: "gpt-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    close = server.close;

    const client = new FetchLlmClient();
    const request = {
      model: "gpt-test",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    client.initialize({ baseUrl: server.url, apiKey: "first-key" });
    const first = await client.chatCompletion(request);
    client.initialize({ baseUrl: server.url, apiKey: "second-key" });
    const second = await client.chatCompletion(request);

    expect(receivedAuth).toEqual(["Bearer first-key", "Bearer second-key"]);
    expect(second).toEqual(first);
  });

  it("[stress] serializes all 250 request messages without drops or duplicates", async () => {
    let receivedBody = "";
    const server = await startServer(async (req, res) => {
      receivedBody = await readBody(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-stress",
          model: "gpt-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "accepted" },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    close = server.close;

    const messages = Array.from({ length: 250 }, (_, index) => ({
      role: "user" as const,
      content: `message-${index.toString().padStart(3, "0")}`,
    }));
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "stress-key" });

    const result = await client.chatCompletion({
      model: "gpt-test",
      messages,
    });

    const wire = JSON.parse(receivedBody) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(wire.messages).toEqual(messages);
    expect(wire.messages).toHaveLength(250);
    expect(new Set(wire.messages.map((message) => message.content)).size).toBe(
      250,
    );
    expect(result).toEqual({
      id: "chatcmpl-stress",
      model: "gpt-test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "accepted" },
          finishReason: "stop",
        },
      ],
    });
  });
});
