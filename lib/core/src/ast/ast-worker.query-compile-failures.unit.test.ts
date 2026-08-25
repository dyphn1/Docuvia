import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LanguageProvider } from "@workspace/ast-core";
import { IpcLogMessageType, LogLevels } from "@workspace/contracts";
import { AstMessages } from "./ast-constants.js";

// The worker's `logger` is module-scoped and posts through `parentPort`, which is null outside a
// real worker thread -- mocking the transport is the only way to observe that a compile failure
// actually leaves the worker instead of being dropped on the floor.
const postMessage = vi.fn();
// `on` is stubbed too: importing ast-worker.js registers its real message handler at module
// load, so the mock has to satisfy that call as well as postMessage.
vi.mock("worker_threads", () => ({
  parentPort: {
    postMessage: (m: unknown) => postMessage(m),
    on: () => undefined,
  },
}));

const { reportQueryCompileFailures } = await import("./ast-worker.js");

/** A provider that reports `failures` once, then nothing -- mirrors DefaultProvider's drain. */
function providerReporting(
  failures: Array<{ kind: string; pattern: string; message: string }>,
): LanguageProvider {
  let drained = false;
  return {
    drainQueryCompileFailures: () => {
      if (drained) return [];
      drained = true;
      return failures;
    },
  } as unknown as LanguageProvider;
}

describe("ast-worker: query-compile failure reporting", () => {
  beforeEach(() => postMessage.mockClear());

  it("posts one IPC log message per failed query, carrying the pattern that failed", () => {
    reportQueryCompileFailures(
      providerReporting([
        {
          kind: "imports",
          pattern: "(export_statement)",
          message: "Invalid node type",
        },
        {
          kind: "variables",
          pattern: "(lexical_declaration)",
          message: "bad field",
        },
      ]),
      "typescript",
    );

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[0]?.[0]).toEqual({
      type: IpcLogMessageType,
      level: LogLevels.ERROR,
      message: AstMessages.QUERY_COMPILE_FAILED,
      context: {
        language: "typescript",
        kind: "imports",
        pattern: "(export_statement)",
        message: "Invalid node type",
      },
    });
  });

  it("stays silent when the provider reports no failures -- the overwhelmingly common case", () => {
    reportQueryCompileFailures(providerReporting([]), "typescript");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("drains, so a second file of the same language does not re-report the same failure", () => {
    const provider = providerReporting([
      {
        kind: "imports",
        pattern: "(export_statement)",
        message: "Invalid node type",
      },
    ]);

    reportQueryCompileFailures(provider, "typescript");
    reportQueryCompileFailures(provider, "typescript");

    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("tolerates a provider that compiles no queries at all (optional method absent)", () => {
    expect(() =>
      reportQueryCompileFailures({} as LanguageProvider, "typescript"),
    ).not.toThrow();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
