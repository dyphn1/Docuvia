// Shared constants for the Projects pages (projects/Index.tsx, projects/ProjectDetail.tsx,
// projects/components/*).

// --- Layout / sizing ---

// Must match the number of TableHead columns rendered in projects/Index.tsx.
export const TABLE_COLUMN_COUNT = 7;

// Number of skeleton placeholders shown while project detail data is loading.
export const PROJECT_DETAIL_SKELETON_GRID_COUNT = 4;

// Number of skeleton rows shown while the L2 directory list is loading.
export const L2_LIST_SKELETON_COUNT = 4;

// Number of skeleton rows shown while the commit list is loading.
export const PROJECT_COMMITS_SKELETON_COUNT = 5;

// Matches the abbreviated commit hash length used across commit displays.
export const SHORT_HASH_LENGTH = 7;

// --- Thresholds ---

export const CONFIDENCE_HIGH_THRESHOLD = 0.8;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.5;

// --- Date formats ---

export const PROJECT_DATE_FORMAT = "MMM d, yyyy";
export const COMMIT_DATE_TIME_FORMAT = "MMM d, yyyy HH:mm";

// --- URLs ---

export const GITHUB_URL_PREFIX = "https://github.com/";

// --- Status / type color maps ---

export const PROJECT_STATUS_ACTIVE = "active";

export const PROJECT_STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  indexing: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  pending: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 border-destructive/20 text-destructive",
};

export const L3_TYPE_COLOR: Record<string, string> = {
  change: "border-blue-500/30 text-blue-400",
  rule: "border-orange-500/30 text-orange-400",
  decision: "border-purple-500/30 text-purple-400",
  context: "border-green-500/30 text-green-400",
};

export const L2_TYPE_COLOR: Record<string, string> = {
  module: "border-primary/40 text-primary",
  package: "border-cyan-500/40 text-cyan-400",
  pcd: "border-amber-500/40 text-amber-400",
};

// L2 type filter options rendered as filter tabs in the L2 directory.
export const L2_TYPE_FILTER_OPTIONS = ["all", "module", "package", "pcd"] as const;

// --- Projects index page copy ---

export const PROJECTS_PAGE_TITLE = "Projects";
export const PROJECTS_PAGE_SUBTITLE = "Manage indexed repositories";
export const ADD_PROJECT_BUTTON_LABEL = "Add Project";
export const PROJECTS_TABLE_HEADERS = [
  "Name",
  "Repository",
  "Status",
  "L2",
  "L3",
  "Commits",
  "Added",
];
export const PROJECTS_LOADING_MESSAGE = "Loading projects...";
export const PROJECTS_EMPTY_TITLE = "No projects yet";
export const ADD_FIRST_PROJECT_BUTTON_LABEL = "Add your first project";
export const ADD_PROJECT_DIALOG_TITLE = "Add New Project";
export const PROJECT_NAME_LABEL = "Project Name";
export const PROJECT_NAME_PLACEHOLDER = "My Repository";
export const REPO_URL_LABEL = "Repository URL";
export const REPO_URL_PLACEHOLDER = "https://github.com/owner/repo";
export const REPO_URL_HELPER_TEXT = "GitHub URLs are supported for commit ingestion";
export const CREATE_PROJECT_CANCEL_LABEL = "Cancel";
export const CREATING_PROJECT_LABEL = "Creating...";
export const CREATE_PROJECT_BUTTON_LABEL = "Create Project";
export const PROJECT_CREATE_ERROR_MESSAGE = "Failed to create project";

// --- Project detail page copy ---

export const PROJECT_NOT_FOUND_MESSAGE = "Project not found";

export const PROJECT_DETAIL_TABS = {
  ARCHITECTURE: "architecture",
  GRAPH: "graph",
  COMMITS: "commits",
  L2: "l2",
  BOOTSTRAP: "bootstrap",
} as const;

export const ARCHITECTURE_FLOW_TAB_LABEL = "Architecture Flow";
export const TOPOLOGY_MAP_TAB_LABEL = "Topology Map";
export const COMMITS_TAB_LABEL = "Commits";
export const L2_DIRECTORY_TAB_LABEL = "L2 Directory";
export const BOOTSTRAP_REVIEW_TAB_LABEL = "Bootstrap Review";
export const INTERACTIVE_TOPOLOGY_MAP_HEADING = "Interactive Topology Map";
export const L2_COMPONENT_DIRECTORY_HEADING = "L2 Component Directory";

export const EXPORT_FILENAME_FALLBACK = "project";
export const EXPORT_FILENAME_SUFFIX = "_export.md";

// --- L2 directory copy ---

export const L2_EMPTY_MESSAGE =
  "No L2 nodes found. Run the AI generation pipeline to extract components.";
export const L2_SEARCH_PLACEHOLDER = "Search components...";
export const L2_NO_RESULTS_MESSAGE = "No results match your filter.";
export const L2_NO_L3_NODES_MESSAGE = "No L3 nodes yet.";
export const L2_ALL_FILTER_LABEL = "All";
export const L3_COUNT_LABEL = "L3";
export const AI_GENERATED_BADGE_LABEL = "AI";
export const NEEDS_REVIEW_BADGE_LABEL = "Review";

// --- Project commits copy ---

export const COMMIT_VALID_LABEL = "VALID";
export const COMMIT_INVALID_LABEL = "INVALID";
export const COMMIT_LINKED_TO_L2_LABEL = "Linked to L2";
export const NO_COMMITS_MESSAGE = "No commits found for this project.";

// --- Project header copy ---

export const EXPORT_MARKDOWN_LABEL = "Export Markdown";
export const EXPORTING_LABEL = "Exporting...";
export const CREATED_LABEL_PREFIX = "Created";
export const L2_NODES_LABEL = "L2 Nodes";
export const L3_NODES_LABEL = "L3 Nodes";
