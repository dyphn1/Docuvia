import type { McpTool } from "./types.js";
import { initTool } from "./init.js";
import { queryTool } from "./query.js";
import { impactTool } from "./impact.js";
import { applyDecisionTool } from "./apply-decision.js";

/**
 * MCP tool registry. Tools are registered as they're rebuilt from the old Docuvia
 * tool set (which also had `context`/`analyze`/`extract`/`clean`/`status`/
 * `detectChanges`/`sync` — none of which exist in Docuvia2 yet).
 *
 * #49: `query` and `impact` replace hook-based CLI spawns with structured MCP calls.
 * #47: `applyDecision` exposes L3 agent-authored staging for cross-platform defense-in-depth.
 */
export const allTools: Record<string, McpTool> = {
  [initTool.definition.name]: initTool,
  [queryTool.definition.name]: queryTool,
  [impactTool.definition.name]: impactTool,
  [applyDecisionTool.definition.name]: applyDecisionTool,
};

export const toolDefinitions = Object.values(allTools).map((t) => t.definition);

export { McpTool };
