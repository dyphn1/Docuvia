import type { McpTool } from "./types.js";
import { initTool } from "./init.js";
import { queryTool } from "./query.js";
import { impactTool } from "./impact.js";
import { statusTool } from "./status.js";
import { detectChangesTool } from "./detect-changes.js";

/**
 * Read-path tools restored per issue #190 (`query`/`impact`/`status`/`detectChanges` existed in
 * old Docuvia; `context`/`analyze`/`extract`/`clean`/`sync` are still pending). Register each
 * new tool here as it's rebuilt.
 */
export const allTools: Record<string, McpTool> = {
  [initTool.definition.name]: initTool,
  [queryTool.definition.name]: queryTool,
  [impactTool.definition.name]: impactTool,
  [statusTool.definition.name]: statusTool,
  [detectChangesTool.definition.name]: detectChangesTool,
};

export const toolDefinitions = Object.values(allTools).map((t) => t.definition);

export { McpTool };
