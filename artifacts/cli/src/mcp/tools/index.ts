import type { McpTool } from "./types.js";
import { initTool } from "./init.js";
import { queryTool } from "./query.js";
import { impactTool } from "./impact.js";
import { statusTool } from "./status.js";
import { detectChangesTool } from "./detect-changes.js";
import { applyDecisionTool } from "./apply-decision.js";

/**
 * MCP tool registry. Tools are registered as they're rebuilt from the old Docuvia
 * tool set (`context`/`analyze`/`extract`/`clean`/`sync` are still pending). Register each
 * new tool here as it's rebuilt.
 *
 * #49: `query` and `impact` replace hook-based CLI spawns with structured MCP calls.
 * #47: `applyDecision` exposes L3 agent-authored staging for cross-platform defense-in-depth.
 */
export const allTools: Record<string, McpTool> = {
  [initTool.definition.name]: initTool,
  [queryTool.definition.name]: queryTool,
  [impactTool.definition.name]: impactTool,
  [statusTool.definition.name]: statusTool,
  [detectChangesTool.definition.name]: detectChangesTool,
  [applyDecisionTool.definition.name]: applyDecisionTool,
};

export const toolDefinitions = Object.values(allTools).map((t) => t.definition);

export { McpTool };
