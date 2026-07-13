import { describe, it, expect, vi } from "vitest";
import { IpcLoggerClient } from "./ipc-logger-client.js";
import type { IIpcLogMessage } from "./ipc-log-message.js";

describe("IpcLoggerClient", () => {
  it("serializes each ILogger method into an IIpcLogMessage with the matching level", () => {
    const postMessageFn = vi.fn();
    const client = new IpcLoggerClient(postMessageFn);

    client.debug("d");
    client.info("i");
    client.warn("w");
    client.error("e");

    const levels = postMessageFn.mock.calls.map(
      ([msg]: [IIpcLogMessage]) => msg.level,
    );
    expect(levels).toEqual(["debug", "info", "warn", "error"]);
  });

  it("includes context only when given", () => {
    const postMessageFn = vi.fn();
    const client = new IpcLoggerClient(postMessageFn);

    client.error("boom", { file: "a.ts" });
    client.error("boom again");

    expect(postMessageFn).toHaveBeenNthCalledWith(1, {
      type: "ipc-log",
      level: "error",
      message: "boom",
      context: { file: "a.ts" },
    });
    expect(postMessageFn).toHaveBeenNthCalledWith(2, {
      type: "ipc-log",
      level: "error",
      message: "boom again",
    });
  });

  it("never throws when calling onLog() — an isolated context has nothing to subscribe to", () => {
    const client = new IpcLoggerClient(vi.fn());
    expect(() => client.onLog()()).not.toThrow();
  });
});
