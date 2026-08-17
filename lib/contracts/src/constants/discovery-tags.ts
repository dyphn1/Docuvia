/**
 * Tag/project-type sentinel values that `ConfigScannerService` both writes (via
 * `CONFIG_DETECTION_RULES`) and reads back (in its post-scan project-type inference fallback),
 * so a typo in either place can't silently desync detection from inference. Shared vocabulary —
 * lives in contracts (issue #94) so upper layers (ui-core/cli) can reference it without a
 * `lib/core` dependency.
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
  RUST: "rust",
  PYTHON: "python",
  GO: "go",
} as const;

/** Fallback tag added when config-file scanning surfaces nothing more specific. */
export const GENERAL_TAG = "general";

/**
 * Non-sentinel tags `CONFIG_DETECTION_RULES` attaches to a matched config file. Unlike
 * `ConfigTags`, none of these are read back/compared elsewhere in `ConfigScannerService` — they're
 * pure output — but several are reused verbatim across multiple detection rules in the same table,
 * so they're still centralized here to keep those repeats in sync.
 */
export const ConfigDetectionTags = {
  FRONTEND: "frontend",
  BACKEND: "backend",
  NEXTJS: "nextjs",
  SSR: "ssr",
  DRIZZLE: "drizzle",
  DATABASE: "database",
  TAILWINDCSS: "tailwindcss",
  CSS: "css",
  JEST: "jest",
  TESTING: "testing",
  VITEST: "vitest",
  POSTGRES: "postgres",
  MONOREPO: "monorepo",
  TOKIO: "tokio",
  ASYNC: "async",
  ACTIX: "actix",
  SERDE: "serde",
  TAURI: "tauri",
  DESKTOP: "desktop",
  DJANGO: "django",
  FASTAPI: "fastapi",
  PANDAS: "pandas",
  DATA: "data",
  GIN: "gin",
  STRICT_TS: "strict-ts",
  VITE: "vite",
  BUILD_TOOL: "build-tool",
} as const;
