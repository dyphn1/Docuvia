import { describe, it, expect, afterEach, vi } from "vitest";
import { FetchLlmClient } from "./fetch-llm-client.js";

describe("FetchLlmClient.checkAvailability() (phase1-decision-integration.md §10e bullet 3, decision 1e)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports available:true for any received HTTP response, including a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 404, statusText: "Not Found" }),
        ),
    );
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: "http://127.0.0.1:9" });

    const result = await client.checkAvailability();

    expect(result).toEqual({ available: true });
  });

  it("reports available:true on a 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: "http://127.0.0.1:9" });

    const result = await client.checkAvailability();

    expect(result).toEqual({ available: true });
  });

  it("reports available:false with a reason on a network-level failure (connection refused/DNS/timeout) -- never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED")),
    );
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: "http://127.0.0.1:9" });

    const result = await client.checkAvailability();

    expect(result.available).toBe(false);
    expect(result.reason).toContain("ECONNREFUSED");
  });

  it("reports available:false without throwing when checkAvailability() is called before initialize()", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = new FetchLlmClient();

    const result = await client.checkAvailability();

    expect(result.available).toBe(false);
  });
});

describe("FetchLlmClient completions URL normalization (phase 1b -- no doubled /v1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubChatCompletionFetch(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
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
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function stubStreamFetch(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("chatCompletion appends /v1/chat/completions to a baseUrl with no /v1 suffix", async () => {
    const fetchMock = stubChatCompletionFetch();
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: "http://localhost:8080" });

    await client.chatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:8080/v1/chat/completions",
    );
  });

  it("chatCompletion does not double /v1 when baseUrl already ends in /v1", async () => {
    const fetchMock = stubChatCompletionFetch();
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: "https://openrouter.ai/api/v1" });

    await client.chatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  it("chatCompletion strips a trailing slash before normalizing a trailing /v1", async () => {
    const fetchMock = stubChatCompletionFetch();
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: "https://openrouter.ai/api/v1/" });

    await client.chatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  it("streamChatCompletion appends /v1/chat/completions to a baseUrl with no /v1 suffix", async () => {
    const fetchMock = stubStreamFetch();
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: "http://localhost:8080" });

    for await (const _chunk of client.streamChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    })) {
      // no-op, draining the stream to [DONE]
    }

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:8080/v1/chat/completions",
    );
  });

  it("streamChatCompletion does not double /v1 when baseUrl already ends in /v1", async () => {
    const fetchMock = stubStreamFetch();
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: "https://openrouter.ai/api/v1" });

    for await (const _chunk of client.streamChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    })) {
      // no-op, draining the stream to [DONE]
    }

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  it("streamChatCompletion strips a trailing slash before normalizing a trailing /v1", async () => {
    const fetchMock = stubStreamFetch();
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: "https://openrouter.ai/api/v1/" });

    for await (const _chunk of client.streamChatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    })) {
      // no-op, draining the stream to [DONE]
    }

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  it("does not strip a baseUrl that merely contains v1 but not as the literal final path segment", async () => {
    const fetchMock = stubChatCompletionFetch();
    const client = new FetchLlmClient();
    client.initialize({ baseUrl: "https://host/apiv1" });

    await client.chatCompletion({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://host/apiv1/v1/chat/completions",
    );
  });
});
