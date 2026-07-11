import { describe, it, expect } from "vitest";
import { Logger, createNoopLogger } from "./logger.js";

describe("Logger", () => {
  it("emits a LogEvent to every registered listener for each level", () => {
    const logger = new Logger();
    const events: any[] = [];
    logger.onLog((e) => events.push(e));

    logger.debug("d");
    logger.info("i", { count: 1 });
    logger.warn("w");
    logger.error("e");

    expect(events).toEqual([
      { level: "debug", message: "d" },
      { level: "info", message: "i", context: { count: 1 } },
      { level: "warn", message: "w" },
      { level: "error", message: "e" },
    ]);
  });

  it("onLog() returns an unsubscribe function", () => {
    const logger = new Logger();
    const events: any[] = [];
    const unsubscribe = logger.onLog((e) => events.push(e));

    logger.info("first");
    unsubscribe();
    logger.info("second");

    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("first");
  });

  it("supports multiple independent listeners", () => {
    const logger = new Logger();
    const a: any[] = [];
    const b: any[] = [];
    logger.onLog((e) => a.push(e));
    logger.onLog((e) => b.push(e));

    logger.info("hello");

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

describe("createNoopLogger", () => {
  it("never throws even with no listeners attached", () => {
    const logger = createNoopLogger();
    expect(() => {
      logger.debug("x");
      logger.info("x");
      logger.warn("x");
      logger.error("x");
    }).not.toThrow();
  });
});
