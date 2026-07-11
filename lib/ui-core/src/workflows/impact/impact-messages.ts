/** Progress/result messages for the `impact` workflow. */
export const IMPACT_MESSAGES = {
  RESOLVING: "Resolving blast radius...",
  DB_NOT_FOUND: 'Local database not found. Please run "docuvia init".',
  ESCALATE_TO_LSP_NOT_IMPLEMENTED:
    "--escalate-to-lsp is not yet implemented; falling back to local graph-based blast radius.",
} as const;
