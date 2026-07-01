import type { McpTool } from "./types.js";
import { contextTool } from "./context.js";
import { impactTool } from "./impact.js";
import { queryLocalTool } from "./query.js";
import { initTool } from "./init.js";
import { analyzeTool } from "./analyze.js";
import { extractTool } from "./extract.js";
import { cleanTool } from "./clean.js";
import { statusTool } from "./status.js";
import { detectChangesTool } from "./detect-changes.js";
import { syncTool } from "./sync.js";

export const allTools: Record<string, McpTool> = {
  [contextTool.definition.name]: contextTool,
  [impactTool.definition.name]: impactTool,
  [queryLocalTool.definition.name]: queryLocalTool,
  [initTool.definition.name]: initTool,
  [analyzeTool.definition.name]: analyzeTool,
  [extractTool.definition.name]: extractTool,
  [cleanTool.definition.name]: cleanTool,
  [statusTool.definition.name]: statusTool,
  [detectChangesTool.definition.name]: detectChangesTool,
  [syncTool.definition.name]: syncTool,
};

export const toolDefinitions = Object.values(allTools).map((t) => t.definition);

export { McpTool };
