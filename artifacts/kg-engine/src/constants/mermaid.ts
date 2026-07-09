// Constants for src/components/graph/ArchitectureFlowchart.tsx
// (Mermaid-based L1/L2/L3 architecture diagram).

// --- Theme literal ---
export const THEME_DARK = "dark";

// --- UI copy / labels ---
export const LOADING_MESSAGE = "Loading architecture...";
export const NO_DATA_MESSAGE = "No data available";
export const GLOBAL_ARCHITECTURE_LABEL = "Global Architecture";
export const FOCUS_DOMAIN_PLACEHOLDER = "Focus Domain (L1)...";
export const FOCUS_COMPONENT_PLACEHOLDER = "Focus Component (L2)...";
export const BREADCRUMB_SEPARATOR = "→";
export const FOCUS_SELECT_TRIGGER_CLASS = "w-[200px] h-8 text-sm";

// --- Node parsing / limits ---
export const MERMAID_UNSAFE_CHARS_REGEX = /["\n\r|]/g;
export const MAX_NODE_TITLE_LENGTH = 60;
export const DEFAULT_LINK_TYPE = "calls";

// --- Chart theme colors ---
export const CHART_THEME_COLORS = {
  dark: {
    defaultFill: "#1e293b",
    defaultStroke: "#334155",
    highlightFill: "#3b82f6",
    highlightStroke: "#2563eb",
    moonFill: "#475569",
    moonStroke: "#64748b",
    text: "#f8fafc",
  },
  light: {
    defaultFill: "#f1f5f9",
    defaultStroke: "#cbd5e1",
    highlightFill: "#bfdbfe",
    highlightStroke: "#60a5fa",
    moonFill: "#e2e8f0",
    moonStroke: "#cbd5e1",
    text: "#0f172a",
  },
} as const;

// --- Mermaid flowchart DSL tokens — centralized so the syntax lives in one
// place instead of being re-typed as raw string fragments in every builder. ---
export const MERMAID_CHART_HEADER = "flowchart LR\n";
export const MERMAID_CLASS_DEFAULT = "default";
export const MERMAID_CLASS_HIGHLIGHT = "highlight";
export const MERMAID_CLASS_MOON = "moon";
export const MERMAID_STROKE_WIDTH_THIN = "1px";
export const MERMAID_STROKE_WIDTH_THICK = "2px";

export const L2_FOCUS_NODE_ID = "L2_FOCUS";
export const DOMAIN_SUBGRAPH_ID = "DOMAIN";
export const EMPTY_NODE_ID = "EMPTY";
export const DEPENDENCY_COUNT_UNIT = "deps";
export const DOMAIN_LABEL_PREFIX = "Domain: ";

// --- Empty-state messages ---
export const EMPTY_L3_MESSAGE = "No decisions/rules documented yet";
export const EMPTY_L2_MESSAGE = "No components in this domain";
export const EMPTY_L1_MESSAGE = "No domains extracted yet";
