/**
 * Tag/project-type sentinel values that `ConfigScannerService` both writes (via
 * `CONFIG_DETECTION_RULES`) and reads back (in its post-scan project-type inference fallback),
 * so a typo in either place can't silently desync detection from inference.
 */
export const ConfigTags = {
  TYPESCRIPT: "typescript",
  REACT: "react",
  EXPRESS: "express",
  VUE: "vue",
} as const;

export const ProjectTypes = {
  UNKNOWN: "unknown",
  JAVASCRIPT: "javascript",
  GENERIC: "generic",
} as const;

/** Fallback tag added when config-file scanning surfaces nothing more specific. */
export const GENERAL_TAG = "general";

export const DISCOVERY_MESSAGES = {
  CONFIG_SCAN_FAILED: "Config scanning failed",
  STARTING_GIT_BLOB_SCAN:
    "Starting global AST scan using Git-native blob hashing",
  GIT_OPS_FAILED_FALLBACK:
    "Git operations failed during discovery, falling back to manual globbing",
  GIT_UNAVAILABLE_FALLBACK:
    "Git unavailable or no .git repository found; falling back to fast-glob + manual sha256 hashing",
  NO_GITIGNORE_FOUND: "No .gitignore found, proceeding without it",
  DISCOVERED_SOURCE_FILES: "Discovered source files",
  SKIPPING_OVERSIZED_FILE: "Skipping oversized file",
  GIT_HASH_DELTA_CHECK_COMPLETE: "Git hash delta check complete",
  VCS_HOTSPOT_DOMAINS_EXTRACTED:
    "VCS hotspot analysis extracted functional domains",
} as const;

/**
 * Ignore patterns shared by every fast-glob scan in this package (config detection and
 * general source-file discovery) — a single source of truth so the two scans can't drift on
 * what "always skip this" means.
 */
export const COMMON_GLOB_IGNORE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
] as const;

/** Top-level path segments `VcsScannerService` never treats as a functional "domain" hotspot. */
export const VCS_IGNORED_TOP_LEVEL_DIRS: string[] = [
  "node_modules",
  "dist",
  "build",
  "docs",
  "test",
  "tests",
  "scripts",
];

/** Structural (non-domain-meaningful) folder names `VcsScannerService` filters out of its final domain guess. */
export const VCS_NON_DOMAIN_DIRS: string[] = ["src", "lib", "app"];
