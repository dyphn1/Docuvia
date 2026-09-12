import { describe, it, expect } from "vitest";
import { IpcLogRouter } from "./ipc-log-router.js";
import { createMockLogger } from "../testing/mocks.js";

// TDD-SOURCE: docs/gitbook/architecture/ipc-logging-architecture.md

describe("IpcLogRouter", () => {
  it("forwards a well-formed ipc-log message to the real logger at the matching level", () => {
    const logger = createMockLogger();
    const router = new IpcLogRouter(logger);

    const handled = router.handleMessage({
      type: "ipc-log",
      level: "error",
      message: "worker crashed",
      context: { file: "a.ts" },
    });

    expect(handled).toBe(true);
    expect(logger.events).toEqual([
      { level: "error", message: "worker crashed", context: { file: "a.ts" } },
    ]);
  });

  it("returns false and does not touch the logger for a message that isn't an ipc-log", () => {
    const logger = createMockLogger();
    const router = new IpcLogRouter(logger);

    expect(router.handleMessage({ taskId: "1", success: true })).toBe(false);
    expect(router.handleMessage(null)).toBe(false);
    expect(router.handleMessage("plain string")).toBe(false);

    expect(logger.events).toEqual([]);
  });

  it("returns false without throwing for tagged but malformed ipc-log payloads", () => {
    const logger = createMockLogger();
    const router = new IpcLogRouter(logger);

    expect(() =>
      router.handleMessage({
        type: "ipc-log",
        level: "fatal",
        message: "unsupported",
      }),
    ).not.toThrow();
    expect(router.handleMessage({ type: "ipc-log", level: "error" })).toBe(
      false,
    );
    expect(
      router.handleMessage({
        type: "ipc-log",
        level: "error",
        message: "bad context",
        context: [],
      }),
    ).toBe(false);

    expect(logger.events).toEqual([]);
  });
});
