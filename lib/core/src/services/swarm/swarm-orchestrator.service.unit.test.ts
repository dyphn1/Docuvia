import { describe, it, expect, vi } from "vitest";
import { SwarmOrchestrator, SwarmAgentDefinition } from "./swarm-orchestrator.service.js";
import { TaskDispatcher } from "./task-dispatcher.js";
import { LlmRateLimiter } from "./llm-rate-limiter.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("SwarmOrchestrator", () => {
  it("should run agents in parallel under the dispatcher cap and synthesize a final report", async () => {
    // Arrange
    const orchestrator = new SwarmOrchestrator();
    let active = 0;
    let peak = 0;

    const makeAgent = (name: string, finding: string): SwarmAgentDefinition<string> => ({
      name,
      run: async () => {
        active++;
        peak = Math.max(peak, active);
        await tick();
        active--;
        return finding;
      },
    });

    const agents = [
      makeAgent("security-subagent", "no injection risks"),
      makeAgent("db-subagent", "indexes look fine"),
      makeAgent("architecture-subagent", "layering respected"),
      makeAgent("style-subagent", "naming consistent"),
    ];

    // Act
    const { results, report } = await orchestrator.review(agents, (settled) =>
      settled
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r.status === "fulfilled" ? `${r.name}: ${r.value}` : ""))
        .join("\n")
    );

    // Assert
    expect(peak).toBeLessThanOrEqual(3);
    expect(results).toHaveLength(4);
    expect(report).toContain("security-subagent: no injection risks");
    expect(report).toContain("style-subagent: naming consistent");
  });

  it("should pass a rate-limited callLlm gateway to each agent", async () => {
    // Arrange
    const rateLimiter = new LlmRateLimiter({
      bucket: { capacity: 10, refillAmount: 10, refillIntervalMs: 100 },
      backoff: { retries: 0, minDelayMs: 1, maxDelayMs: 1, factor: 1 },
    });
    const executeSpy = vi.spyOn(rateLimiter, "execute");
    const orchestrator = new SwarmOrchestrator(new TaskDispatcher(), rateLimiter);

    const agent: SwarmAgentDefinition<string> = {
      name: "security-subagent",
      run: (context) => context.callLlm(async () => "llm-answer"),
    };

    // Act
    const { results } = await orchestrator.review([agent], (settled) => settled);

    // Assert
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ status: "fulfilled", value: "llm-answer" });
  });

  it("should aggregate partial findings when a subagent fails", async () => {
    // Arrange
    const orchestrator = new SwarmOrchestrator();
    const agents: SwarmAgentDefinition<string>[] = [
      { name: "ok-agent", run: async () => "finding" },
      {
        name: "broken-agent",
        run: async () => {
          throw new Error("agent exploded");
        },
      },
    ];

    // Act
    const { results, report } = await orchestrator.review(agents, (settled) => ({
      fulfilled: settled.filter((r) => r.status === "fulfilled").length,
      rejected: settled.filter((r) => r.status === "rejected").length,
    }));

    // Assert — the failure never aborts the swarm; aggregation still runs
    expect(report).toEqual({ fulfilled: 1, rejected: 1 });
    const failure = results.find((r) => r.name === "broken-agent");
    expect(failure?.status === "rejected" && failure.error.message).toBe("agent exploded");
  });
});
