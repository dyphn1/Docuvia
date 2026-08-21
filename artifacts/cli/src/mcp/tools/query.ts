import crypto from "node:crypto";
import { z } from "zod";
import { docuviaMemory, MemoryKeys } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";
import { MCP_CONTENT_TYPE_TEXT } from "../constants.js";
import { createPinoBackedLogger } from "../../logging/create-logger.js";

/**
 * #49 MCP read-path tool: `query`
 *
 * Replaces `.claude/hooks/docuvia-hook.js`'s `execFileSync`-per-call pattern with a
 * structured MCP call against the persistent server. Reuses `docuviaApi.query()` — zero
 * duplicate implementation.
 *
 * Returns the `LocalQueryResult` shape (JSON-serialized) so the agent gets structured data
 * instead of `--format=prompt` prose.
 */
const QueryToolInputSchema = z
  .object({
    target: z
      .string()
      .min(1, "target is required")
      .describe(
        "Concept, file path, or symbol to search for in the knowledge graph",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of results to return"),
  })
  .strict();

const DOCUVIA_QUERY_TOOL_NAME = "docuvia_query";
const DOCUVIA_QUERY_TOOL_DESCRIPTION =
  "Query the local Docuvia knowledge graph for concepts, files, or symbols. " +
  "Returns structured results including match type, node details, and relevance scores.";
const JSON_SCHEMA_TYPE_OBJECT = "object";

export const queryTool: McpTool = {
  definition: {
    name: DOCUVIA_QUERY_TOOL_NAME,
    description: DOCUVIA_QUERY_TOOL_DESCRIPTION,
    inputSchema: {
      type: JSON_SCHEMA_TYPE_OBJECT,
      properties: {
        target: {
          type: "string",
          description:
            "Concept, file path, or symbol to search for in the knowledge graph",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return",
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
          {
            type: MCP_CONTENT_TYPE_TEXT,
            text: JSON.stringify(result),
          },
        ],
      };
    } finally {
      docuviaMemory.deleteScope(scopeId);
    }
  }),
};
