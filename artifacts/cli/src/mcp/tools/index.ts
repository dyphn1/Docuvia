import type { McpTool } from "./types.js";
import { initTool } from "./init.js";

/**
 * Trimmed to just `docuvia_init` for this milestone (per the migration plan's step 9) —
 * old Docuvia's version also registered `context`/`impact`/`query`/`analyze`/`extract`/
 * `clean`/`status`/`detectChanges`/`sync` tools, none of which exist in Docuvia2 yet.
 * Register each new tool here as it's rebuilt.
 */
export const allTools: Record<string, McpTool> = {
  [initTool.definition.name]: initTool,
};

export const toolDefinitions = Object.values(allTools).map((t) => t.definition);

export { McpTool };
