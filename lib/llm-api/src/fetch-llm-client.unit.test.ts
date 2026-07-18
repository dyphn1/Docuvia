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
