import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  CHAT_TOOL_TYPE,
  ChatMessageRoles,
  ChatToolChoiceModes,
  DocuviaError,
  ErrorCodes,
  type ChatCompletionRequest,
} from "@workspace/contracts";
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
        close: () => new Promise((done) => server.close(() => done())),
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

describe("Phase 7 FetchLlmClient contract quality", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
  });

  it("[happy] preserves optional request fields and returns the complete validated tool-call response shape", async () => {
    let receivedBody = "";
    const server = await startServer(async (req, res) => {
      receivedBody = await readBody(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-tool",
          model: "gpt-test",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                name: "assistant-name",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "lookup", arguments: '{"id":7}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url, apiKey: "phase7-key" });
    const result = await client.chatCompletion({
      model: "gpt-test",
      messages: [
        { role: ChatMessageRoles.SYSTEM, content: "rules" },
        { role: ChatMessageRoles.USER, content: "lookup", name: "caller" },
        {
          role: ChatMessageRoles.ASSISTANT,
          content: null,
          toolCalls: [
            {
              id: "call-0",
              type: CHAT_TOOL_TYPE,
              function: { name: "lookup", arguments: '{"id":6}' },
            },
          ],
        },
        {
          role: ChatMessageRoles.TOOL,
          content: '{"ok":true}',
          toolCallId: "call-0",
        },
      ],
      tools: [
        {
          type: CHAT_TOOL_TYPE,
          function: {
            name: "lookup",
            description: "lookup a record",
            parameters: { type: "object" },
          },
        },
      ],
      toolChoice: {
        type: CHAT_TOOL_TYPE,
        function: { name: "lookup" },
      },
      temperature: 0,
      maxTokens: 7,
    });

    const wire = JSON.parse(receivedBody);
    expect(wire).toEqual({
      model: "gpt-test",
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "lookup", name: "caller" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-0",
              type: "function",
              function: { name: "lookup", arguments: '{"id":6}' },
            },
          ],
        },
        { role: "tool", content: '{"ok":true}', tool_call_id: "call-0" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "lookup a record",
            parameters: { type: "object" },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "lookup" } },
      temperature: 0,
      max_tokens: 7,
      stream: false,
    });
    expect(result).toEqual({
      id: "chatcmpl-tool",
      model: "gpt-test",
      choices: [
        {
          index: 0,
          message: {
            role: ChatMessageRoles.ASSISTANT,
            content: null,
            name: "assistant-name",
            toolCalls: [
              {
                id: "call-1",
                type: CHAT_TOOL_TYPE,
                function: { name: "lookup", arguments: '{"id":7}' },
              },
            ],
          },
          finishReason: "tool_calls",
        },
      ],
    });
  });

  it("[invalid-input] rejects valid JSON with wrong required completion field types as LLM_INVALID_RESPONSE", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: 42, model: "gpt-test", choices: [] }));
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url });

    const error = await captureDocuviaError(
      client.chatCompletion({
        model: "gpt-test",
        messages: [{ role: ChatMessageRoles.USER, content: "hello" }],
      }),
    );
    expect(error.code).toBe(ErrorCodes.LLM_INVALID_RESPONSE);
    expect(
      error.message.startsWith(
        "Chat completion failed: response body did not match the chat-completion contract",
      ),
    ).toBe(true);
  });

  it("rejects a valid-JSON SSE chunk with wrong required field types", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-bad",
          model: "gpt-test",
          choices: [
            {
              index: 0,
              delta: { content: 123 },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
      res.end();
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url });

    const error = await captureDocuviaError(
      (async () => {
        for await (const _chunk of client.streamChatCompletion({
          model: "gpt-test",
          messages: [{ role: ChatMessageRoles.USER, content: "hello" }],
        })) {
          // drain
        }
      })(),
    );
    expect(error.code).toBe(ErrorCodes.LLM_STREAM_FAILED);
    expect(
      error.message.startsWith(
        "Chat completion stream failed: chunk did not match the chat-completion contract",
      ),
    ).toBe(true);
  });

  it("[error-handling] preserves an exact HTTP failure reason and error code", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "maintenance-window" }));
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url });

    const error = await captureDocuviaError(
      client.chatCompletion({
        model: "gpt-test",
        messages: [{ role: ChatMessageRoles.USER, content: "hello" }],
      }),
    );
    expect(error.code).toBe(ErrorCodes.LLM_HTTP_FAILED);
    expect(error.message).toBe("Chat completion failed: maintenance-window");
  });

  it("returns identical completion results and wire bodies across repeated identical input", async () => {
    const bodies: string[] = [];
    const server = await startServer(async (req, res) => {
      bodies.push(await readBody(req));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-stable",
          model: "gpt-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "stable" },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url });
    const request: ChatCompletionRequest = {
      model: "gpt-test",
      messages: [{ role: ChatMessageRoles.USER, content: "same" }],
      toolChoice: ChatToolChoiceModes.NONE,
    };

    const first = await client.chatCompletion(request);
    const second = await client.chatCompletion(request);

    expect(second).toEqual(first);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it("[state-diff] observes changed completion state instead of serving a stale prior response", async () => {
    let content = "before";
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-changing",
          model: "gpt-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url });
    const request: ChatCompletionRequest = {
      model: "gpt-test",
      messages: [{ role: ChatMessageRoles.USER, content: "state" }],
    };

    const before = await client.chatCompletion(request);
    expect(before.choices[0]?.message.content).toBe("before");

    content = "after";
    const after = await client.chatCompletion(request);
    expect(after.choices[0]?.message.content).toBe("after");
    expect(after).not.toEqual(before);
  });

  it("[stress] preserves all 250 completion choices with unique indexes and deterministic repeated reads", async () => {
    const wireChoices = Array.from({ length: 250 }, (_, index) => ({
      index,
      message: {
        role: "assistant",
        content: `choice-${index.toString().padStart(3, "0")}`,
      },
      finish_reason: "stop",
    }));
    const expectedChoices = wireChoices.map((choice) => ({
      index: choice.index,
      message: {
        role: ChatMessageRoles.ASSISTANT,
        content: choice.message.content,
      },
      finishReason: choice.finish_reason,
    }));
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-stress",
          model: "gpt-test",
          choices: wireChoices,
        }),
      );
    });
    close = server.close;

    const client = new FetchLlmClient();
    client.initialize({ baseUrl: server.url });
    const request: ChatCompletionRequest = {
      model: "gpt-test",
      messages: [{ role: ChatMessageRoles.USER, content: "stress" }],
    };

    const first = await client.chatCompletion(request);
    const second = await client.chatCompletion(request);

    expect(first).toEqual({
      id: "chatcmpl-stress",
      model: "gpt-test",
      choices: expectedChoices,
    });
    expect(second).toEqual(first);
    expect(new Set(first.choices.map((choice) => choice.index)).size).toBe(250);
    expect(
      new Set(first.choices.map((choice) => choice.message.content)).size,
    ).toBe(250);
  });
});
