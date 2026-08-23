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
 * #49 MCP read-path tool: `impact`
 *
 * Blast-radius analysis via MCP — replaces hook-based CLI spawns. Reuses
 * `docuviaApi.impact()` — zero duplicate implementation.
 *
 * Returns `ImpactResult` (JSON-serialized) with blast radius entries, risk level, and
 * optional coverage hints. Emits `null` when the target doesn't resolve.
 */
const ImpactToolInputSchema = z
  .object({
    target: z
      .string()
      .min(1, "target is required")
      .describe("File path, symbol, or concept to analyze blast radius for"),
  })
  .strict();

const DOCUVIA_IMPACT_TOOL_NAME = "docuvia_impact";
const DOCUVIA_IMPACT_TOOL_DESCRIPTION =
  "Analyze the blast radius of changing a file, symbol, or concept. " +
  "Returns which other parts of the codebase would be affected, with a risk level assessment.";
const JSON_SCHEMA_TYPE_OBJECT = "object";

export const impactTool: McpTool = {
  definition: {
    name: DOCUVIA_IMPACT_TOOL_NAME,
    description: DOCUVIA_IMPACT_TOOL_DESCRIPTION,
    inputSchema: {
      type: JSON_SCHEMA_TYPE_OBJECT,
      properties: {
        target: {
          type: "string",
          description:
            "File path, symbol, or concept to analyze blast radius for",
        },
      },
      required: ["target"],
    },
  },
  handler: withErrorHandling(
    MCP_TOOL_MESSAGES.ERROR_IMPACT_ANALYSIS,
    async (args) => {
      const input = ImpactToolInputSchema.parse(args ?? {});

      const scopeId = crypto.randomUUID();
      const logger = createPinoBackedLogger();
      docuviaMemory.createScope(scopeId);
      docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, process.cwd());
      docuviaMemory.set(scopeId, MemoryKeys.TARGET, input.target);

      try {
        const result = await docuviaApi.impact(scopeId, logger);
        return {
          content: [
            {
              type: MCP_CONTENT_TYPE_TEXT,
              text: result === null ? "null" : JSON.stringify(result),
            },
          ],
        };
      } finally {
        docuviaMemory.deleteScope(scopeId);
      }
    },
  ),
};
