export const SEARCH_RESULT_LIMIT = 20;
export const ALL_PROJECTS_FILTER = "all";

export const SEARCH_MODE_KEYWORD_GRAPH = "keyword_graph";
export const SEARCH_MODE_SEMANTIC_VECTOR = "semantic_vector";

export const QUERY_PAGE_TITLE = "Semantic Knowledge Query";
export const QUERY_PAGE_SUBTITLE =
  "Search across all L1 tags, L2 modules, and L3 decision records. Results traverse the full knowledge hierarchy.";

export const ALL_PROJECTS_LABEL = "All projects";
export const SEARCH_INPUT_PLACEHOLDER = 'e.g., "How does the authentication module work?"';
export const SEARCH_BUTTON_TEXT = "Search";
export const SEARCH_FAILED_MESSAGE = "Search failed";

export const RESULTS_HEADING = "Results";
export const RESULTS_MATCHES_SUFFIX = "matches";
export const RESULTS_OF_TEXT = "of";

export const SEARCH_MODE_LABELS = {
  keywordGraph: "Local Keyword/Graph Mode",
  semanticVector: "Semantic Vector Mode",
} as const;

export const KEYWORD_FALLBACK_NOTICE =
  "Semantic vector search is unavailable — results were resolved via keyword (FTS) matching and knowledge-graph traversal instead.";

export const NO_RESULTS_PREFIX = 'No results found for "';
export const NO_RESULTS_SUFFIX = '"';
export const NO_RESULTS_HINT =
  "Try a different search term or run the AI pipeline to generate more knowledge nodes.";

export const MCP_EXAMPLE_COMMANDS = [
  "search_knowledge(query, project?)",
  "get_dependencies(module)",
  "impact_analysis(module)",
  "get_decision_record(commit_hash)",
];

export const MCP_ENDPOINTS_AVAILABLE_TEXT = "MCP tool endpoints available at";
export const MCP_ENDPOINTS_PATH_LABEL = "/api/mcp/*";

// Tailwind JIT requires literal (non-interpolated) class strings, so per-layer styles
// are kept as full class strings here rather than composed dynamically.
export const NODE_LAYER_COLORS: Record<string, string> = {
  l1: "bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400",
  l2: "bg-primary/10 border-primary/20 text-primary",
  l3: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
};
