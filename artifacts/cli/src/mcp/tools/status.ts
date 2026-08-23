import crypto from "node:crypto";
import { z } from "zod";
import { docuviaMemory, MemoryKeys } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";
import { MCP_CONTENT_TYPE_TEXT } from "../constants.js";
import { createPinoBackedLogger } from "../../logging/create-logger.js";

const StatusToolInputSchema = z.object({}).strict();

const DOCUVIA_STATUS_TOOL_NAME = "docuvia_status";

/** `StatusResult` has no JSON contract yet (the human CLI renders a table) — this is the MCP
 *  serialization: verbatim counters plus a derived Tier B coverage percentage so an agent can
 *  judge graph completeness without doing the math. */
export const statusTool: McpTool = {
  definition: {
    name: DOCUVIA_STATUS_TOOL_NAME,
    description: MCP_TOOL_MESSAGES.STATUS_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: withErrorHandling(
    MCP_TOOL_MESSAGES.ERROR_GETTING_STATUS,
    async (args) => {
      StatusToolInputSchema.parse(args ?? {});

      const scopeId = crypto.randomUUID();
      const logger = createPinoBackedLogger();
      docuviaMemory.createScope(scopeId);
      docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, process.cwd());

      try {
        const status = await docuviaApi.status(scopeId, logger);
        const tierBCoveragePct =
          status.tierBFilesTotal > 0
            ? Number(
                (
                  (status.tierBFilesProcessed / status.tierBFilesTotal) *
                  100
                ).toFixed(1),
              )
            : 0;
        return {
          content: [
            {
              type: MCP_CONTENT_TYPE_TEXT,
              text: JSON.stringify({ ...status, tierBCoveragePct }, null, 2),
            },
          ],
        };
      } finally {
        docuviaMemory.deleteScope(scopeId);
      }
    },
  ),
};
