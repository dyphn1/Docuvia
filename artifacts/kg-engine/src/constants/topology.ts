// Constants for the force-directed Topology feature, shared across:
//   - src/components/graph/ProjectTopologyGraph.tsx (react-force-graph-2d canvas)
//   - src/pages/TopologyGraphLogic.ts (d3-force layout engine)
//   - src/pages/Topology.tsx (custom SVG blast-radius explorer page)

// --- Shared type/kind codes (TopologyGraphLogic.ts + Topology.tsx) ---
export const LINK_TYPE_CONTAINS = "contains";
export const LINK_TYPE_DECISION = "decision";
export const NODE_KIND_DECISION = "decision";
export const NODE_KIND_FILE = "file";

// --- TopologyGraphLogic.ts: force simulation tuning (d3-force). Values chosen
// empirically for a readable, well-separated layout. ---
export const GROUP_RING_RADIUS_UNIT = 150;
export const CONTAINMENT_LINK_DISTANCE = 60;
export const DEFAULT_LINK_DISTANCE = 140;
export const LINK_STRENGTH = 0.4;
export const CHARGE_STRENGTH = -150;
export const CHARGE_DISTANCE_MAX = 450;
export const GROUP_CENTERING_STRENGTH = 0.08;
export const DECISION_NODE_RADIUS = 6;
export const NODE_RADIUS_BASE = 6;
export const NODE_RADIUS_DEGREE_SCALE = 14;

export const PALETTE = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AC",
  "#5B8DEF",
  "#8CD17D",
];
export const DECISION_COLOR = "#E8B931";

// --- ProjectTopologyGraph.tsx: react-force-graph-2d rendering ---
export const THEME_DARK = "dark";
export const FORCE_GRAPH_LOADING_MESSAGE = "Loading topology...";
export const FORCE_GRAPH_NO_DATA_MESSAGE =
  "No topology data available. Ensure the AST parser has run.";

export const DEFAULT_GRAPH_WIDTH = 800;
export const DEFAULT_GRAPH_HEIGHT = 600;

// Node "val" drives both the rendered circle radius and the force-simulation repulsion/charge.
export const NODE_SIZE_L1 = 35; // Sun (L1 domain)
export const NODE_SIZE_L2 = 15; // Planet (L2 module)
export const NODE_SIZE_L3 = 5; // Moon (L3 decision/rule)

export const LINK_LABEL_BELONGS_TO = "belongs_to";
export const LINK_LABEL_IMPLEMENTS = "implements";
export const DEFAULT_LINK_TYPE = "calls";

export const NODE_REL_SIZE = 6;
export const LINK_ARROW_LENGTH = 3.5;
export const LINK_ARROW_REL_POS = 1;

export const NODE_CLICK_PAN_DURATION_MS = 1000;
export const NODE_CLICK_ZOOM_LEVEL = 8;
export const NODE_CLICK_ZOOM_DURATION_MS = 2000;

export const LABEL_BASE_FONT_SIZE_PX = 12;
export const LABEL_VISIBLE_ZOOM_THRESHOLD = 1.5;
export const LABEL_HIGHLIGHT_FONT_BONUS_PX = 2;
export const LABEL_Y_OFFSET_PX = 6;
export const SUN_GLOW_BLUR_PX = 15;

export const TOPOLOGY_COLORS = {
  dark: {
    l1: "#fde047",
    l2: "#60a5fa",
    l3: "#94a3b8",
    l1LinkColor: "rgba(253, 224, 71, 0.4)",
    l3LinkColor: "rgba(148, 163, 184, 0.4)",
    l2LinkColor: "rgba(255,255,255,0.2)",
    background: "#0f172a",
    labelText: "#e2e8f0",
  },
  light: {
    l1: "#eab308",
    l2: "#3b82f6",
    l3: "#64748b",
    l1LinkColor: "rgba(234, 179, 8, 0.4)",
    l3LinkColor: "rgba(100, 116, 139, 0.4)",
    l2LinkColor: "rgba(0,0,0,0.2)",
    background: "#f8fafc",
    labelText: "#1e293b",
  },
} as const;

// --- Topology.tsx: SVG canvas tuning / thresholds ---
export const BLAST_RADIUS_MAX_DEPTH = 3;
export const SEARCH_RESULTS_LIMIT = 15;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
export const ZOOM_STEP_FACTOR = 1.5;
export const WHEEL_ZOOM_SENSITIVITY = 0.0012;
export const DRAG_MOVE_THRESHOLD_PX = 3;
export const FIT_VIEW_PADDING_PX = 200;
export const FIT_VIEW_MAX_ZOOM = 2;
export const HULL_EXPAND_FACTOR = 1.25;
export const NODE_LABEL_MAX_LENGTH = 34;
export const LABEL_VISIBILITY_DEGREE_RATIO = 0.3;
export const BLAST_HIGHLIGHT_COLOR = "#ff6b6b";
export const DEFAULT_LINK_COLOR = "#8b98b8";
export const FILE_NODE_STROKE_COLOR = "#f1f4fb";
export const SELECTION_RING_COLOR = "#ffffff";

// --- Topology.tsx: copy / labels ---
export const SEARCH_INPUT_PLACEHOLDER = "Search nodes…";
export const PROJECT_SELECT_LOADING_PLACEHOLDER = "Loading projects…";
export const PROJECT_SELECT_PLACEHOLDER = "Select project";
export const NODE_INFO_TITLE = "Node Info";
export const NODE_INFO_EMPTY_HINT =
  "Click a node to inspect it. Click it again to highlight its blast radius (upstream dependents).";
export const GROUPS_TITLE = "Groups";
export const TOPOLOGY_TITLE = "Topology";
export const TOPOLOGY_LOADING_MESSAGE = "Building topology…";
export const TOPOLOGY_ERROR_MESSAGE = "Failed to load topology.";
export const GROUP_LABEL_PREFIX = "group: ";
export const DEGREE_LABEL_PREFIX = "degree: ";
export const TAGS_LABEL_PREFIX = "tags: ";
export const BLAST_RADIUS_LABEL_PREFIX = "blast radius: ";
export const BLAST_RADIUS_LABEL_SUFFIX = " upstream nodes";
export const STATS_NODES_SUFFIX = " nodes · ";
export const STATS_LINKS_SUFFIX = " links ·";
export const STATS_GROUPS_SUFFIX = " groups";
export const STATS_COLLAPSED_SUFFIX = " · collapsed to file level";

// --- Topology.tsx: test ids ---
export const TOPOLOGY_PAGE_TEST_ID = "topology-page";
export const TOPOLOGY_SEARCH_TEST_ID = "topology-search";
export const TOPOLOGY_NODE_INFO_TEST_ID = "topology-node-info";
export const TOPOLOGY_PROJECT_SELECT_TEST_ID = "topology-project-select";
export const TOPOLOGY_CANVAS_TEST_ID = "topology-canvas";

// --- Topology.tsx: SVG rendering magic numbers / CSS keyword tokens ---
export const HULL_FILL_OPACITY = 0.06;
export const HULL_STROKE_OPACITY = 0.3;
export const HULL_STROKE_WIDTH_BASE = 1.5;
export const HULL_LABEL_FONT_SIZE_BASE = 13;
export const HULL_LABEL_OPACITY = 0.75;
export const DECISION_LINK_DASH_ON_PX = 4;
export const DECISION_LINK_DASH_OFF_PX = 3;
export const LINK_OPACITY_DIMMED = 0.04;
export const LINK_OPACITY_CONTAINS = 0.1;
export const LINK_OPACITY_BLAST = 0.9;
export const LINK_OPACITY_DEFAULT = 0.35;
export const LINK_STROKE_WIDTH_BLAST = 2;
export const LINK_STROKE_WIDTH_DEFAULT = 1;
export const NODE_DIMMED_OPACITY = 0.12;
export const NODE_STROKE_WIDTH_BASE = 1;
export const SELECTION_RING_RADIUS_PADDING_PX = 3;
export const SELECTION_RING_STROKE_WIDTH = 2.5;
export const NODE_LABEL_OFFSET_X_PX = 3;
export const NODE_LABEL_OFFSET_Y_PX = 4;
export const NODE_LABEL_FONT_SIZE_BASE = 11;
export const NODE_LABEL_OPACITY = 0.85;
export const BLAST_LABEL_MIN_ZOOM = 0.7;
export const STROKE_NONE = "none";
export const CURRENT_COLOR = "currentColor";
