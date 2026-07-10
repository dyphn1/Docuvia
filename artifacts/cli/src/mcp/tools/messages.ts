export const MCP_TOOL_MESSAGES = {
  ERROR_GENERIC: "Error",
  ERROR_MISSING_TARGET: "Error: Missing target.",
  ERROR_MISSING_QUERY_TARGET: "Error: Missing 'target' argument.",
  ERROR_MISSING_FILE_PATH: "Error: Missing 'filePath' argument.",
  ERROR_MISSING_PROJECT_ID: "Error: Missing 'projectId' argument.",
  ERROR_MISSING_SYNC_ENV: "Error: DOCUVIA_API_URL or MCP_PAT is missing in the environment.",

  ERROR_ANALYZING: "Error analyzing project",
  ERROR_CLEANING: "Error cleaning database",
  ERROR_INITIALIZING: "Error initializing Docuvia",
  ERROR_QUERYING: "Error executing query",
  ERROR_DETECTING_CHANGES: "Error detecting changes",
  ERROR_EXTRACTING: "Error extracting decisions",
  ERROR_SYNCING: "Error syncing project",
  ERROR_CHECKING_STATUS: "Error checking status",

  ANALYZE_COMPLETE: (projectType: string, tags: string[]) =>
    `Analysis complete. Type: ${projectType}. Tags: ${tags.join(", ")}`,
  CLEAN_SUCCESS: "Cleaned .docuvia/local.db database.",
  CLEAN_NOT_FOUND: "No local database found to clean.",
  INIT_SUCCESS: "Docuvia initialized successfully.",
  EXTRACT_COMPLETE: (
    decisions: Array<{ title: string; nodeType: string; content: string; confidence: number }>
  ) =>
    decisions.length === 0
      ? "Extraction complete. No decision-worthy content found."
      : `Extraction complete.\nDecisions:\n${decisions
          .map((d) => `- [${d.nodeType}] ${d.title} (confidence: ${d.confidence})\n  ${d.content}`)
          .join("\n")}`,
  STATUS_REPORT: (status: { projects: number; l2Nodes: number; l3Nodes: number }) =>
    `=== Docuvia Index Status ===\nProjects: ${status.projects}\nL2 Nodes: ${status.l2Nodes}\nL3 Decisions: ${status.l3Nodes}`,
  SYNC_COMPLETE: (projectId: string) => `Sync completed for project ${projectId}.`,
  SYMBOL_NOT_FOUND: (target: string) => `Symbol "${target}" not found in Docuvia index.`,
  NO_CONTEXT_FOUND: "No context found.",
} as const;
