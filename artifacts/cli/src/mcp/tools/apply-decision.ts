import crypto from "node:crypto";
import { z } from "zod";
import { docuviaMemory, MemoryKeys } from "@workspace/contracts";
import { docuviaApi, type ExtractedDecision } from "@workspace/ui-core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";
import { MCP_CONTENT_TYPE_TEXT } from "../constants.js";
import { createPinoBackedLogger } from "../../logging/create-logger.js";

/**
 * #47 MCP write-path tool: `applyDecision`
 *
 * Exposes the L3 agent-authored staging operation (`analyze <path> --agent-authored --stage`)
 * as an MCP tool for cross-platform defense-in-depth. Backed by the same
 * `docuviaApi.stageAgentAuthoredDecisions()` — zero duplicate implementation.
 *
 * Why this exists (from #47):
 * - MCP tool definitions persist across the session and survive context compaction better
 *   than prose mandates in AGENTS.md.
 * - Server-side logging provides an audit trail for free (file + timestamp).
 * - Cross-platform: MCP is supported by Claude Code, Cursor, Codex CLI, Copilot Chat —
 *   unlike PostToolUse hooks which only cover Claude/Cursor.
 *
 * The staged decisions flush into `l3_nodes` automatically on the next commit that touches
 * the target file (via `docuvia analyze --flush-staged-l3` in the post-commit hook).
 */
const DecisionItemSchema = z.object({
  title: z.string().min(1, "title is required"),
  content: z.string().min(1, "content is required"),
  nodeType: z.enum(["change", "rule", "decision", "context"]),
  confidence: z.number().min(0).max(1),
});

const ApplyDecisionInputSchema = z
  .object({
    targetPath: z
      .string()
      .min(1, "targetPath is required")
      .describe(
        "File path (relative to workspace root) these decisions apply to",
      ),
    decisions: z
      .array(DecisionItemSchema)
      .min(1, "at least one decision is required")
      .describe("Array of L3 decisions to stage for this file"),
  })
  .strict();

const DOCUVIA_APPLY_DECISION_TOOL_NAME = "docuvia_apply_decision";
const DOCUVIA_APPLY_DECISION_TOOL_DESCRIPTION =
  "Stage agent-authored L3 decisions for a file. " +
  "Staged decisions are flushed into the knowledge graph automatically on the next " +
  "git commit that touches the target file. Use this after making code changes that " +
  "reflect architectural decisions, rules, or notable rationale.";
const JSON_SCHEMA_TYPE_OBJECT = "object";

export const applyDecisionTool: McpTool = {
  definition: {
    name: DOCUVIA_APPLY_DECISION_TOOL_NAME,
    description: DOCUVIA_APPLY_DECISION_TOOL_DESCRIPTION,
    inputSchema: {
      type: JSON_SCHEMA_TYPE_OBJECT,
      properties: {
        targetPath: {
          type: "string",
          description:
            "File path (relative to workspace root) these decisions apply to",
        },
        decisions: {
          type: "array",
          description: "Array of L3 decisions to stage for this file",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Decision title" },
              content: {
                type: "string",
                description: "Decision content / rationale",
              },
              nodeType: {
                type: "string",
                enum: ["change", "rule", "decision", "context"],
                description: "Type of the L3 node",
              },
              confidence: {
                type: "number",
                description: "Confidence score between 0 and 1",
              },
            },
            required: ["title", "content", "nodeType", "confidence"],
          },
        },
      },
      required: ["targetPath", "decisions"],
    },
  },
  handler: withErrorHandling(
    MCP_TOOL_MESSAGES.ERROR_APPLYING_DECISION,
    async (args) => {
      const input = ApplyDecisionInputSchema.parse(args ?? {});

      const scopeId = crypto.randomUUID();
      const logger = createPinoBackedLogger();
      docuviaMemory.createScope(scopeId);
      docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, process.cwd());
      docuviaMemory.set(scopeId, MemoryKeys.TARGET_PATH, input.targetPath);
      docuviaMemory.set(
        scopeId,
        MemoryKeys.AGENT_AUTHORED_DECISIONS,
        input.decisions as ExtractedDecision[],
      );

      try {
        const result = await docuviaApi.stageAgentAuthoredDecisions(
          scopeId,
          logger,
        );
        return {
          content: [
            {
              type: MCP_CONTENT_TYPE_TEXT,
              text: `${result.staged} decision(s) staged — flushed automatically on the next commit that touches ${input.targetPath}.`,
            },
          ],
        };
      } finally {
        docuviaMemory.deleteScope(scopeId);
      }
    },
  ),
};
