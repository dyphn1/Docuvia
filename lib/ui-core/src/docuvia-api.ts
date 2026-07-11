import { docuviaMemory, DocuviaError, ErrorCodes, type ILogger } from "@workspace/contracts";
import { InitWorkflow } from "./workflows/init/init-workflow.js";
import type { InitResult } from "./workflows/init/init-result.js";

/**
 * The unified `docuviaApi` — the only surface `artifacts/cli`/`mcp` call (see
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Orchestration Layer). Callers
 * must have already created a `docuviaMemory` scope for `scopeId` and set `workspaceRoot`
 * before calling; they own deleting that scope once the run completes (Garbage Collection).
 */
export const docuviaApi = {
  async init(scopeId: string, logger: ILogger): Promise<InitResult> {
    const workspaceRoot = docuviaMemory.get<string>(scopeId, "workspaceRoot");
    if (!workspaceRoot) {
      throw new DocuviaError(
        ErrorCodes.INVALID_INPUT,
        `docuviaApi.init: no "workspaceRoot" set in memory scope "${scopeId}"`
      );
    }
    return new InitWorkflow(workspaceRoot, logger).execute();
  },
};
