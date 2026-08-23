import crypto from "node:crypto";
import { z } from "zod";
import { docuviaMemory, MemoryKeys } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";
import { MCP_CONTENT_TYPE_TEXT } from "../constants.js";
import { createPinoBackedLogger } from "../../logging/create-logger.js";

const ImpactToolInputSchema = z
  .object({
    target: z.string().min(1),
  })
  .strict();

const DOCUVIA_IMPACT_TOOL_NAME = "docuvia_impact";

export const impactTool: McpTool = {
  definition: {
    name: DOCUVIA_IMPACT_TOOL_NAME,
    description: MCP_TOOL_MESSAGES.IMPACT_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "Symbol name or file path whose dependents (blast radius) should be computed.",
        },
      },
      required: ["target"],
    },
  },
  handler: withErrorHandling(
    MCP_TOOL_MESSAGES.ERROR_ANALYZING_IMPACT,
    async (args) => {
      const input = ImpactToolInputSchema.parse(args ?? {});

      const scopeId = crypto.randomUUID();
      const logger = createPinoBackedLogger();
      docuviaMemory.createScope(scopeId);
      docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, process.cwd());
      docuviaMemory.set(scopeId, MemoryKeys.TARGET, input.target);

      try {
        // `null` is a legal outcome (unresolved target), not a failure — the CLI's
        // `--format=json` emits the literal `null` for the same distinction. Never map it to
        // isError; instead steer the agent toward resolving the target first.
        const result = await docuviaApi.impact(scopeId, logger);
        if (!result) {
          return {
            content: [
              { type: MCP_CONTENT_TYPE_TEXT, text: "null" },
              {
                type: MCP_CONTENT_TYPE_TEXT,
                text: MCP_TOOL_MESSAGES.IMPACT_NOT_FOUND_HINT,
              },
            ],
          };
        }

        const hints: { type: string; text: string }[] = [
          {
            type: MCP_CONTENT_TYPE_TEXT,
            text: JSON.stringify(result, null, 2),
          },
        ];
        if (
          result.blastRadius.length === 0 &&
          result.tierBCoverage &&
          result.tierBCoverage.workspaceFilesProcessed <
            result.tierBCoverage.workspaceFilesTotal
        ) {
          hints.push({
            type: MCP_CONTENT_TYPE_TEXT,
            text: MCP_TOOL_MESSAGES.IMPACT_EMPTY_HINT,
          });
        }
        return { content: hints };
      } finally {
        docuviaMemory.deleteScope(scopeId);
      }
    },
  ),
};
