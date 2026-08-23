/**
 * MCP tool error message prefixes. Each tool's `withErrorHandling` wrapper prefixes the
 * tool-specific string before `e.message`, so the MCP consumer gets a diagnosable payload
 * without a stack trace.
 */
export const MCP_TOOL_MESSAGES = {
  ERROR_INITIALIZING: "Error initializing Docuvia",
  ERROR_QUERYING: "Error querying Docuvia knowledge graph",
  ERROR_IMPACT_ANALYSIS: "Error analyzing impact",
  ERROR_APPLYING_DECISION: "Error applying decision",
} as const;
