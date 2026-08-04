import { describe, it, expect, vi } from "vitest";
import { Language } from "web-tree-sitter";
import { buildParseResponse } from "./ast-worker.js";

describe("ast-worker.ts: Language.load() caching (typescript-cli-benchmark.md §7.2/§7.4)", () => {
  it("loads a language's grammar once, not once per file, across two buildParseResponse() calls for the same language", async () => {
    const loadSpy = vi.spyOn(Language, "load"); // spy-through: real WASM still loads, matching this directory's existing "not mocked" fixture style

    const first = await buildParseResponse({
      taskId: "t1",
      filePath: "a.ts",
      code: "function helper() { return 1; }",
      language: "typescript",
    });
    const callsAfterFirst = loadSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0); // sanity: the first call really did load

    const second = await buildParseResponse({
      taskId: "t2",
      filePath: "b.ts",
      code: "function other() { return 2; }",
      language: "typescript",
    });

    // The actual success criterion: a second file of the SAME language must not trigger
    // another real Language.load() call.
    expect(loadSpy.mock.calls.length).toBe(callsAfterFirst);

    // Behavior-preservation, not just call-count: both parses still produce correct data.
    expect(first.success).toBe(true);
    expect(first.data!.functions.map((f) => f.name)).toContain("helper");
    expect(second.success).toBe(true);
    expect(second.data!.functions.map((f) => f.name)).toContain("other");

    loadSpy.mockRestore();
  });

  it("still loads a distinct language's grammar (cache is keyed per-language, not a single global 'loaded once ever' flag)", async () => {
    const loadSpy = vi.spyOn(Language, "load");

    // A language not already resident in this test file's module-level cache from the
    // previous test -- ast-worker.ts's languageCache is module-scoped, so it persists across
    // `it()` blocks within this one file (same as registryPromise/parserInitialized already
    // do). Picking a language this file hasn't touched yet keeps this assertion meaningful
    // regardless of test execution order within the file.
    const response = await buildParseResponse({
      taskId: "t3",
      filePath: "main.rs",
      code: "fn hello() {}",
      language: "rust",
    });

    expect(loadSpy.mock.calls.length).toBeGreaterThan(0);
    expect(response.success).toBe(true);
    expect(response.data!.functions.map((f) => f.name)).toContain("hello");

    loadSpy.mockRestore();
  });
});
