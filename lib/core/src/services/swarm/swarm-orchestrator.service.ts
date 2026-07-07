import { logger } from "../../utils/logger.js";
import { TaskDispatcher, DispatchResult, DispatchTask } from "./task-dispatcher.js";
import { LlmRateLimiter } from "./llm-rate-limiter.js";

/**
 * Execution context handed to each swarm agent. All LLM traffic must flow
 * through `callLlm` so the shared token bucket and exponential backoff apply
 * across the whole swarm (ADR-032).
 */
export interface SwarmAgentContext {
  /** Agent name as registered with the orchestrator. */
  agentName: string;
  /** Rate-limited gateway for LLM API calls (Token Bucket + Exponential Backoff). */
  callLlm: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface SwarmAgentDefinition<TFinding> {
  /** Specialized persona, e.g. "security-subagent", "db-subagent". */
  name: string;
  /** Independent, asynchronous agent body (Background Agentic RAG allowed). */
  run: (context: SwarmAgentContext) => Promise<TFinding>;
}

export interface SwarmReviewResult<TFinding, TReport> {
  /** Settled per-agent outcomes (fulfilled findings and rejected errors). */
  results: DispatchResult<TFinding>[];
  /** Synthesized final output produced by the aggregation phase. */
  report: TReport;
}

/**
 * SwarmOrchestrator — Master Orchestrator for parallel swarm review (ADR-032).
 *
 * Dispatches specialized subagents concurrently through the TaskDispatcher
 * (hard cap: max 3 active parallel agents), routes their LLM calls through a
 * shared LlmRateLimiter, and once all agents settle runs the aggregation
 * phase to synthesize the independent findings into a final report.
 */
export class SwarmOrchestrator {
  constructor(
    private readonly dispatcher: TaskDispatcher = new TaskDispatcher(),
    private readonly rateLimiter: LlmRateLimiter = new LlmRateLimiter()
  ) {}

  public async review<TFinding, TReport>(
    agents: SwarmAgentDefinition<TFinding>[],
    synthesize: (results: DispatchResult<TFinding>[]) => Promise<TReport> | TReport
  ): Promise<SwarmReviewResult<TFinding, TReport>> {
    logger.info(
      { agents: agents.map((a) => a.name), concurrency: this.dispatcher.concurrency },
      "[SwarmOrchestrator] Dispatching parallel swarm"
    );

    const tasks: DispatchTask<TFinding>[] = agents.map((agent) => ({
      name: agent.name,
      run: () =>
        agent.run({
          agentName: agent.name,
          callLlm: (fn) => this.rateLimiter.execute(fn),
        }),
    }));

    // Independent parallel execution — every agent settles before aggregation.
    const results = await this.dispatcher.dispatchAll(tasks);

    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn(
          { agent: result.name, error: result.error.message },
          "[SwarmOrchestrator] Subagent failed; continuing with partial findings"
        );
      }
    }

    // Aggregation / synthesis phase.
    const report = await synthesize(results);
    logger.info(
      { fulfilled: results.filter((r) => r.status === "fulfilled").length, total: results.length },
      "[SwarmOrchestrator] Aggregation phase complete"
    );

    return { results, report };
  }
}
