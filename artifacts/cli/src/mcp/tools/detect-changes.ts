import crypto from "node:crypto";
import { z } from "zod";
import { docuviaMemory, MemoryKeys } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";
import { MCP_CONTENT_TYPE_TEXT } from "../constants.js";
import { createPinoBackedLogger } from "../../logging/create-logger.js";

const DetectChangesToolInputSchema = z
  .object({
    baseRef: z.string().min(1).optional(),
  })
  .strict();

const DOCUVIA_DETECT_CHANGES_TOOL_NAME = "docuvia_detect_changes";

export const detectChangesTool: McpTool = {
  definition: {
    name: DOCUVIA_DETECT_CHANGES_TOOL_NAME,
    description: MCP_TOOL_MESSAGES.DETECT_CHANGES_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        baseRef: {
          type: "string",
          description:
            "Git ref to diff against (branch name, tag, or SHA). Defaults to the workspace's configured base branch.",
        },
      },
    },
  },
  handler: withErrorHandling(
    MCP_TOOL_MESSAGES.ERROR_DETECTING_CHANGES,
    async (args) => {
      const input = DetectChangesToolInputSchema.parse(args ?? {});

      const scopeId = crypto.randomUUID();
      const logger = createPinoBackedLogger();
      docuviaMemory.createScope(scopeId);
      docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, process.cwd());
      if (input.baseRef) {
        docuviaMemory.set(scopeId, MemoryKeys.BASE_REF, input.baseRef);
      }

      try {
        // Mirrors the CLI `review --format=json` contract: the structured ChangeDetectionResult
        // verbatim, so both surfaces share one machine-readable shape.
        const result = await docuviaApi.review(scopeId, logger);
        return {
          content: [
            {
              type: MCP_CONTENT_TYPE_TEXT,
              text: JSON.stringify(result, null, 2),
            },
            {
              type: MCP_CONTENT_TYPE_TEXT,
              text: MCP_TOOL_MESSAGES.REVIEW_NEXT_STEP_HINT,
            },
          ],
        };
      } finally {
        docuviaMemory.deleteScope(scopeId);
      }
    },
  ),
};
