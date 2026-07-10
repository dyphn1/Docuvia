import pLimit from "p-limit";

/**
 * Hard upper bound on concurrently active parallel agents (ADR-032).
 * Mapped to local hardware capacity to prevent CPU starvation and DB deadlocks.
 */
export const MAX_PARALLEL_AGENTS = 3;

export interface DispatchTask<T> {
  /** Human-readable agent/task name (e.g. "security-subagent"). */
  name: string;
  run: () => Promise<T>;
}

export type DispatchResult<T> =
  | { name: string; status: "fulfilled"; value: T }
  | { name: string; status: "rejected"; error: Error };

/**
 * TaskDispatcher — bounded concurrency queue for parallel swarm agents (ADR-032).
 *
 * Dispatches tasks with at most `concurrency` running at once, hard-capped at
 * MAX_PARALLEL_AGENTS regardless of the requested value. A failing task never
 * aborts its siblings; every task settles into a DispatchResult so the
 * aggregation phase can synthesize partial findings.
 */
export class TaskDispatcher {
  public readonly concurrency: number;
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(concurrency: number = MAX_PARALLEL_AGENTS) {
    this.concurrency = Math.max(1, Math.min(Math.floor(concurrency), MAX_PARALLEL_AGENTS));
    this.limit = pLimit(this.concurrency);
  }

  /** Number of tasks currently executing (never exceeds `concurrency`). */
  public get activeCount(): number {
    return this.limit.activeCount;
  }

  /** Runs all tasks under the concurrency cap and waits for every one to settle. */
  public async dispatchAll<T>(tasks: DispatchTask<T>[]): Promise<DispatchResult<T>[]> {
    return Promise.all(tasks.map((task) => this.dispatch(task)));
  }

  /** Queues a single task; resolves once the task settles. */
  public async dispatch<T>(task: DispatchTask<T>): Promise<DispatchResult<T>> {
    return this.limit(async () => {
      try {
        const value = await task.run();
        return { name: task.name, status: "fulfilled" as const, value };
      } catch (error: unknown) {
        return {
          name: task.name,
          status: "rejected" as const,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    });
  }
}
