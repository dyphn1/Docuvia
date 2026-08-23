import crypto from "node:crypto";
import { z } from "zod";
import { docuviaMemory, MemoryKeys } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";
import { MCP_CONTENT_TYPE_TEXT } from "../constants.js";
import { createPinoBackedLogger } from "../../logging/create-logger.js";
import { formatPromptOutput } from "../../prompt-format/query-prompt-formatter.js";

const QueryToolInputSchema = z
  .object({
    target: z.string().min(1),
    limit: z.number().int().positive().optional(),
  })
  .strict();

const DOCUVIA_QUERY_TOOL_NAME = "docuvia_query";

export const queryTool: McpTool = {
  definition: {
    name: DOCUVIA_QUERY_TOOL_NAME,
    description: MCP_TOOL_MESSAGES.QUERY_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "Symbol name, file path, or concept phrase to search for.",
        },
        limit: {
          type: "number",
          description: "Maximum number of L3 decisions to return.",
        },
      },
      required: ["target"],
    },
  },
  handler: withErrorHandling(MCP_TOOL_MESSAGES.ERROR_QUERYING, async (args) => {
    const input = QueryToolInputSchema.parse(args ?? {});

    const scopeId = crypto.randomUUID();
    const logger = createPinoBackedLogger();
    docuviaMemory.createScope(scopeId);
    docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, process.cwd());
    docuviaMemory.set(scopeId, MemoryKeys.TARGET, input.target);
    if (input.limit !== undefined) {
      docuviaMemory.set(scopeId, MemoryKeys.LIMIT, input.limit);
    }

    try {
      const result = await docuviaApi.query(scopeId, logger);
      return {
        content: [
          { type: MCP_CONTENT_TYPE_TEXT, text: formatPromptOutput(result) },
          {
            type: MCP_CONTENT_TYPE_TEXT,
            text: MCP_TOOL_MESSAGES.QUERY_NEXT_STEP_HINT,
          },
        ],
      };
    } finally {
      docuviaMemory.deleteScope(scopeId);
    }
  }),
};
