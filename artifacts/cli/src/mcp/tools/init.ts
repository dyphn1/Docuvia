import crypto from "node:crypto";
import { z } from "zod";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../../registration.js";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";
import { createPinoBackedLogger } from "../../logging/create-logger.js";

/** Boundary validation (design-spirit.md #4) — `docuvia_init` takes no arguments today, but every MCP tool input is parsed regardless so a future field addition can't silently skip validation. */
const InitToolInputSchema = z.object({}).strict();

export const initTool: McpTool = {
  definition: {
    name: "docuvia_init",
    description:
      "Initialize the local Docuvia SQLite database in the current workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: withErrorHandling(
    MCP_TOOL_MESSAGES.ERROR_INITIALIZING,
    async (args) => {
      InitToolInputSchema.parse(args ?? {});

      const scopeId = crypto.randomUUID();
      const logger = createPinoBackedLogger();
      docuviaMemory.createScope(scopeId);
      docuviaMemory.set(scopeId, "workspaceRoot", process.cwd());

      try {
        const result = await docuviaApi.init(scopeId, logger);
        return {
          content: [{ type: "text", text: result.message }],
        };
      } finally {
        docuviaMemory.deleteScope(scopeId);
      }
    },
  ),
};
