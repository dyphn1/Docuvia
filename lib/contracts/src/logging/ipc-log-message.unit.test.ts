import { describe, expect, it } from "vitest";
import { isIpcLogMessage } from "./ipc-log-message.js";

// TDD-SOURCE: docs/gitbook/architecture/ipc-logging-architecture.md

describe("isIpcLogMessage", () => {
  it("accepts the complete documented IPC log wire shape for every supported level", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(
        isIpcLogMessage({
          type: "ipc-log",
          level,
          message: `message-${level}`,
          context: { file: "a.ts", attempt: 1 },
        }),
      ).toBe(true);
    }
  });

  it("accepts a valid IPC log message when optional context is omitted", () => {
    expect(
      isIpcLogMessage({
        type: "ipc-log",
        level: "info",
        message: "hello",
      }),
    ).toBe(true);
  });

  it("rejects tagged payloads with a missing or unsupported level", () => {
    expect(isIpcLogMessage({ type: "ipc-log", message: "missing-level" })).toBe(
      false,
    );
    expect(
      isIpcLogMessage({
        type: "ipc-log",
        level: "fatal",
        message: "unsupported-level",
      }),
    ).toBe(false);
  });

  it("rejects tagged payloads with a missing or non-string message", () => {
    expect(isIpcLogMessage({ type: "ipc-log", level: "error" })).toBe(false);
    expect(
      isIpcLogMessage({ type: "ipc-log", level: "error", message: 42 }),
    ).toBe(false);
  });

  it("rejects tagged payloads whose context is not a record", () => {
    expect(
      isIpcLogMessage({
        type: "ipc-log",
        level: "warn",
        message: "bad-context",
        context: ["not", "a", "record"],
      }),
    ).toBe(false);
    expect(
      isIpcLogMessage({
        type: "ipc-log",
        level: "warn",
        message: "bad-context",
        context: null,
      }),
    ).toBe(false);
  });

  it("rejects unrelated primitives, null, arrays, and non-log objects", () => {
    for (const value of [
      null,
      "ipc-log",
      1,
      [],
      { taskId: "1", success: true },
    ]) {
      expect(isIpcLogMessage(value)).toBe(false);
    }
  });

  it("returns the same validation result across repeated identical inputs", () => {
    const message = {
      type: "ipc-log",
      level: "error",
      message: "deterministic",
      context: { file: "same.ts" },
    } as const;

    expect(isIpcLogMessage(message)).toBe(true);
    expect(isIpcLogMessage(message)).toBe(true);
  });
});
