import { describe, it, expect } from "vitest";
import { TaskDispatcher, MAX_PARALLEL_AGENTS } from "./task-dispatcher.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("TaskDispatcher", () => {
  it("should never run more than the hard cap of 3 agents concurrently", async () => {
    // Arrange
    const dispatcher = new TaskDispatcher();
    let active = 0;
    let peak = 0;

    const tasks = Array.from({ length: 10 }, (_, i) => ({
      name: `agent-${i}`,
      run: async () => {
        active++;
        peak = Math.max(peak, active);
        await tick();
        await tick();
        active--;
        return i;
      },
    }));

    // Act
    const results = await dispatcher.dispatchAll(tasks);

    // Assert
    expect(peak).toBeLessThanOrEqual(MAX_PARALLEL_AGENTS);
    expect(peak).toBe(3);
    expect(results).toHaveLength(10);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("should clamp a requested concurrency above the hard cap down to 3", () => {
    // Arrange / Act
    const dispatcher = new TaskDispatcher(50);

    // Assert
    expect(dispatcher.concurrency).toBe(MAX_PARALLEL_AGENTS);
  });

  it("should clamp a concurrency below 1 up to 1", () => {
    // Arrange / Act
    const dispatcher = new TaskDispatcher(0);

    // Assert
    expect(dispatcher.concurrency).toBe(1);
  });

  it("should settle failing tasks as rejected without aborting siblings", async () => {
    // Arrange
    const dispatcher = new TaskDispatcher(2);
    const tasks = [
      { name: "ok-1", run: async () => "a" },
      {
        name: "boom",
        run: async () => {
          throw new Error("agent crashed");
        },
      },
      { name: "ok-2", run: async () => "b" },
    ];

    // Act
    const results = await dispatcher.dispatchAll(tasks);

    // Assert
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    const failed = results[1];
    expect(failed.status === "rejected" && failed.error.message).toBe("agent crashed");
  });

  it("should report activeCount as 0 once all tasks settle", async () => {
    // Arrange
    const dispatcher = new TaskDispatcher(2);

    // Act
    await dispatcher.dispatchAll([
      { name: "a", run: async () => 1 },
      { name: "b", run: async () => 2 },
    ]);

    // Assert
    expect(dispatcher.activeCount).toBe(0);
  });
});
