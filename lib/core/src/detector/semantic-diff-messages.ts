/** Log messages for `SemanticDiffAnalyzerService` — its sole consumer. */
export const SemanticDiffMessages = {
  DETECTOR_FAILED:
    "SemanticDiffDetector failed; treating file as unclassified for Tier B",
  NO_GRAMMAR_AVAILABLE:
    "No tree-sitter grammar available for semantic-diff classification; changed file will still be re-parsed",
  GRAMMAR_LOAD_FAILED:
    "Failed to load tree-sitter grammar for semantic-diff classification",
} as const;
