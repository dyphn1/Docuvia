export interface McpEndpointParam {
  name: string;
  placeholder: string;
  required: boolean;
}

export interface McpEndpoint {
  name: string;
  method: "GET" | "POST";
  path: string;
  description: string;
  params: McpEndpointParam[];
}

export const MCP_ENDPOINT_NAMES = {
  LIST_PROJECTS: "list_projects",
  SEARCH_KNOWLEDGE: "search_knowledge",
  GET_DEPENDENCIES: "get_dependencies",
  IMPACT_ANALYSIS: "impact_analysis",
  GET_DECISION_RECORD: "get_decision_record",
} as const;

export const MCP_ENDPOINTS: McpEndpoint[] = [
  {
    name: MCP_ENDPOINT_NAMES.LIST_PROJECTS,
    method: "GET",
    path: "/api/mcp/list_projects",
    description: "List all projects with their L2/L3 node counts",
    params: [],
  },
  {
    name: MCP_ENDPOINT_NAMES.SEARCH_KNOWLEDGE,
    method: "GET",
    path: "/api/mcp/search_knowledge",
    description: "Semantic search across the knowledge graph",
    params: [
      { name: "query", placeholder: "e.g. authentication module", required: true },
      { name: "project_id", placeholder: "optional project ID", required: false },
      { name: "limit", placeholder: "10", required: false },
    ],
  },
  {
    name: MCP_ENDPOINT_NAMES.GET_DEPENDENCIES,
    method: "GET",
    path: "/api/mcp/get_dependencies",
    description: "Get module dependency graph (what does this module depend on?)",
    params: [
      { name: "module", placeholder: "e.g. auth-service", required: true },
      { name: "project_id", placeholder: "optional project ID", required: false },
    ],
  },
  {
    name: MCP_ENDPOINT_NAMES.IMPACT_ANALYSIS,
    method: "GET",
    path: "/api/mcp/impact_analysis",
    description: "Impact analysis (what breaks if this module changes?)",
    params: [
      { name: "module", placeholder: "e.g. database-layer", required: true },
      { name: "project_id", placeholder: "optional project ID", required: false },
    ],
  },
  {
    name: MCP_ENDPOINT_NAMES.GET_DECISION_RECORD,
    method: "GET",
    path: "/api/mcp/get_decision_record",
    description: "Fetch L3 decision records linked to a commit hash",
    params: [{ name: "commit_hash", placeholder: "e.g. a1b2c3d", required: true }],
  },
];

export const COPY_FEEDBACK_DURATION_MS = 2000;

export const MCP_UNKNOWN_ENDPOINT_ERROR = "Unknown endpoint";
export const MCP_REQUEST_FAILED_MESSAGE = "Request failed";
export const MCP_RUN_BUTTON_LOADING_TEXT = "Calling...";
export const MCP_RUN_BUTTON_TEXT = "Run";
export const MCP_RESPONSE_LABEL = "Response";

export const MCP_PAGE_TITLE = "MCP Tool Endpoints";
export const MCP_PAGE_SUBTITLE =
  "Phase 5 — Agent-callable endpoints following the Model Context Protocol pattern";
export const MCP_TOOLS_AVAILABLE_SUFFIX = "tools available";

export const MCP_BASE_URL_PATH = "/api/mcp/";
export const MCP_GET_METHOD_LABEL = "GET";
export const MCP_INTRO_TITLE = "Using these endpoints in an AI agent";
export const MCP_INTRO_TEXT_BASE_URL =
  "These REST endpoints can be called by any LLM agent as tools. Base URL:";
export const MCP_INTRO_TEXT_JSON_PREFIX = "All endpoints return JSON. Use";
export const MCP_INTRO_TEXT_JSON_SUFFIX =
  "with query parameters. Integrate with Claude, GPT-4, or any agent framework by registering these as tool definitions.";
