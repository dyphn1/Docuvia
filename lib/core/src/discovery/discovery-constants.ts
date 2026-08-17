import { NODE_MODULES_DIR_NAME } from "@workspace/contracts";

/** Stable ids for each entry in `CONFIG_DETECTION_RULES`, looked up by id in its unit tests. */
export const ConfigRuleIds = {
  PACKAGE_JSON_TYPESCRIPT: "package.json:typescript",
  PACKAGE_JSON_REACT: "package.json:react",
  PACKAGE_JSON_VUE: "package.json:vue",
  PACKAGE_JSON_NEXT: "package.json:next",
  PACKAGE_JSON_EXPRESS: "package.json:express",
  PACKAGE_JSON_DRIZZLE_ORM: "package.json:drizzle-orm",
  PACKAGE_JSON_TAILWINDCSS: "package.json:tailwindcss",
  PACKAGE_JSON_JEST: "package.json:jest",
  PACKAGE_JSON_VITEST: "package.json:vitest",
  PACKAGE_JSON_PG: "package.json:pg",
  PACKAGE_JSON_WORKSPACES: "package.json:workspaces",
  CARGO_BASE: "cargo:base",
  CARGO_TOKIO: "cargo:tokio",
  CARGO_ACTIX: "cargo:actix",
  CARGO_SERDE: "cargo:serde",
  CARGO_TAURI: "cargo:tauri",
  PYTHON_BASE: "python:base",
  PYTHON_DJANGO: "python:django",
  PYTHON_FASTAPI: "python:fastapi",
  PYTHON_PANDAS: "python:pandas",
  GO_BASE: "go:base",
  GO_GIN: "go:gin",
  TSCONFIG_STRICT: "tsconfig:strict",
  VITE_PRESENCE: "vite:presence",
  DRIZZLE_PRESENCE: "drizzle:presence",
  TAURI_PRESENCE: "tauri:presence",
} as const;

/** Exact basenames `CONFIG_DETECTION_RULES` matches on (`exact(...)`/`isPythonMarker`), plus
 *  `jsconfig.json` (`LspPreflight`'s tsconfig-resolvable check treats it as an alternative to
 *  `tsconfig.json`, never matched by a `CONFIG_DETECTION_RULES` entry of its own). */
export const ConfigFilenames = {
  PACKAGE_JSON: "package.json",
  CARGO_TOML: "Cargo.toml",
  PYPROJECT_TOML: "pyproject.toml",
  REQUIREMENTS_TXT: "requirements.txt",
  GO_MOD: "go.mod",
  TSCONFIG_JSON: "tsconfig.json",
  JSCONFIG_JSON: "jsconfig.json",
} as const;

/** Basename prefixes `CONFIG_DETECTION_RULES` matches on (`prefix(...)`) for presence-only configs, plus `webpack.config` (glob-scanned only — no detection rule of its own). */
export const ConfigFilePrefixes = {
  VITE_CONFIG: "vite.config",
  DRIZZLE_CONFIG: "drizzle.config",
  TAURI_CONF: "tauri.conf",
  WEBPACK_CONFIG: "webpack.config",
} as const;

/** Substrings `CONFIG_DETECTION_RULES`'s `includesRule(...)` entries search for in a matched
 *  config file's raw content — `package.json` markers are quoted (matching the JSON key
 *  form), `Cargo.toml`/`go.mod`/python markers are bare (matching either a TOML key or a plain
 *  import/dependency name). */
export const ConfigMarkers = {
  PACKAGE_JSON_TYPESCRIPT: '"typescript"',
  PACKAGE_JSON_REACT: '"react"',
  PACKAGE_JSON_VUE: '"vue"',
  PACKAGE_JSON_NEXT: '"next"',
  PACKAGE_JSON_EXPRESS: '"express"',
  PACKAGE_JSON_DRIZZLE_ORM: '"drizzle-orm"',
  PACKAGE_JSON_TAILWINDCSS: '"tailwindcss"',
  PACKAGE_JSON_JEST: '"jest"',
  PACKAGE_JSON_VITEST: '"vitest"',
  PACKAGE_JSON_PG: '"pg"',
  PACKAGE_JSON_WORKSPACES: '"workspaces"',
  CARGO_TOKIO: "tokio",
  CARGO_ACTIX: "actix",
  CARGO_SERDE: "serde",
  CARGO_TAURI: "tauri",
  PYTHON_DJANGO: "django",
  PYTHON_FASTAPI: "fastapi",
  PYTHON_PANDAS: "pandas",
  GO_GIN: "gin-gonic",
} as const;

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
  `${NODE_MODULES_DIR_NAME}/**`,
  ".git/**",
  "dist/**",
  "build/**",
] as const;

/** Top-level path segments `VcsScannerService` never treats as a functional "domain" hotspot. */
export const VCS_IGNORED_TOP_LEVEL_DIRS: string[] = [
  NODE_MODULES_DIR_NAME,
  "dist",
  "build",
  "docs",
  "test",
  "tests",
  "scripts",
];

/**
 * Top-level path segment `VcsScannerService` treats as a workspace's conventional source root
 * when deriving a functional domain from a changed file path (e.g. `src/auth` -> `auth`). Shared
 * with `VCS_NON_DOMAIN_DIRS` below so the two checks can't drift on what "src" means.
 */
export const SRC_DIR_SEGMENT = "src";

/** Structural (non-domain-meaningful) folder names `VcsScannerService` filters out of its final domain guess. */
export const VCS_NON_DOMAIN_DIRS: string[] = [SRC_DIR_SEGMENT, "lib", "app"];
