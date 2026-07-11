import { describe, it, expect } from "vitest";
import { IpcLogRouter } from "./ipc-log-router.js";
import { createMockLogger } from "../testing/mocks.js";

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
});
