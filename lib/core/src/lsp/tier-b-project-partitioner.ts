import fs from "node:fs";
import path from "node:path";
import {
  TIER_B_LANGUAGE_IDS,
  type TierBLanguageId,
} from "@workspace/contracts";
import { ConfigFilenames } from "../discovery/discovery-constants.js";

/**
 * One Tier B project shard unit (PRJ-001): a directory that owns a contiguous slice of a language
 * bucket's files -- the nearest ancestor of each file that contains the language's project marker
 * (Cargo.toml, go.mod, package.json/tsconfig, a .csproj, ...). Grouping a bucket's files by owning
 * project is what lets a shard's LSP server be pointed at the project root (PRJ-002) instead of
 * loading the whole workspace.
 */
export interface TierBProjectGroup {
  /** Absolute path to the project root (a dir containing the language's project marker; the
   *  workspace root itself when a file has no owning marker). */
  root: string;
  /** Workspace-relative posix file paths owned by this project, in input order. */
  files: string[];
  /** Absolute paths to the project roots this project depends on (path/workspace/reference deps
   *  parsed from its project file) -- the edges PRJ-003's bottom-up ordering walks. Roots not
   *  present in the current batch are simply ignored by the sorter. */
  deps: string[];
}

/** Ordered result of partitioning one language bucket (PRJ-001 + PRJ-003). */
export interface TierBProjectPartition {
  /** Project groups ordered dependency-first (leaves/deps before dependents), deterministic even
   *  across a dependency cycle (path-order tiebreak). */
  groups: TierBProjectGroup[];
  /** Workspace-relative posix file -> owning project root (absolute). Files with no owning marker
   *  map to the workspace root. */
  fileToProjectRoot: Map<string, string>;
}

export interface PartitionTierBBucketInput {
  workspaceRoot: string;
  languageId: TierBLanguageId;
  /** Workspace-relative posix file paths, already dispatched to `languageId`'s provider. */
  files: readonly string[];
}

interface ProjectMarkerRule {
  languageId: TierBLanguageId;
  /** Exact basenames that mark a project root when present in a directory. */
  basenames: readonly string[];
  /** Name suffixes that mark a project root when any entry in the directory matches (name-varying
   *  markers like `*.csproj`). */
  suffixes: readonly string[];
}

/**
 * Per-language project markers (PRJ-001) -- the same boundary files the per-language
 * `*-lsp-preflight` gates already recognize, listed here so a bucket can be *enumerated* into
 * projects rather than only checked for existence at the workspace root.
 */
const PROJECT_MARKER_RULES: readonly ProjectMarkerRule[] = [
  {
    languageId: TIER_B_LANGUAGE_IDS.RUST,
    basenames: [ConfigFilenames.CARGO_TOML],
    suffixes: [],
  },
  {
    languageId: TIER_B_LANGUAGE_IDS.GO,
    basenames: [ConfigFilenames.GO_MOD],
    suffixes: [],
  },
  {
    languageId: TIER_B_LANGUAGE_IDS.TYPESCRIPT,
    basenames: [
      ConfigFilenames.PACKAGE_JSON,
      ConfigFilenames.TSCONFIG_JSON,
      ConfigFilenames.JSCONFIG_JSON,
    ],
    suffixes: [],
  },
  {
    languageId: TIER_B_LANGUAGE_IDS.PYTHON,
    basenames: [ConfigFilenames.PYPROJECT_TOML, "setup.py", "setup.cfg"],
    suffixes: [],
  },
  {
    languageId: TIER_B_LANGUAGE_IDS.CSHARP,
    basenames: [],
    suffixes: [".csproj", ".sln", ".slnx"],
  },
  {
    languageId: TIER_B_LANGUAGE_IDS.JAVA,
    basenames: ["pom.xml", "build.gradle", "build.gradle.kts"],
    suffixes: [],
  },
  {
    languageId: TIER_B_LANGUAGE_IDS.CPP,
    basenames: ["CMakeLists.txt", "meson.build", "BUILD", "Makefile"],
    suffixes: [],
  },
  {
    languageId: TIER_B_LANGUAGE_IDS.PHP,
    basenames: ["composer.json"],
    suffixes: [],
  },
  {
    languageId: TIER_B_LANGUAGE_IDS.RUBY,
    basenames: ["Gemfile"],
    suffixes: [".gemspec"],
  },
];

/** Whether a directory is a project root for `rule` -- basenames via `existsSync`, suffixes via a
 *  single directory listing (cached per-dir so the walk never re-reads the same directory). */
function dirHasMarker(
  dir: string,
  rule: ProjectMarkerRule,
  cache: Map<string, boolean>,
): boolean {
  const cached = cache.get(dir);
  if (cached !== undefined) return cached;
  let hit = false;
  if (rule.basenames.length > 0) {
    hit = rule.basenames.some((name) => fs.existsSync(path.join(dir, name)));
  }
  if (!hit && rule.suffixes.length > 0) {
    try {
      hit = fs
        .readdirSync(dir)
        .some((entry) =>
          rule.suffixes.some((suffix) => entry.endsWith(suffix)),
        );
    } catch {
      hit = false;
    }
  }
  cache.set(dir, hit);
  return hit;
}

/** Nearest ancestor of `file` (walking up to and including `workspaceRoot`) that is a project root
 *  for `rule`; `workspaceRoot` when no marker exists anywhere on the path (PRJ-001 fallback). */
function findOwningProjectRoot(
  workspaceRoot: string,
  file: string,
  rule: ProjectMarkerRule,
  cache: Map<string, boolean>,
): string {
  let dir = path.dirname(path.join(workspaceRoot, file));
  while (true) {
    if (dirHasMarker(dir, rule, cache)) return dir;
    if (dir === workspaceRoot) return workspaceRoot;
    const parent = path.dirname(dir);
    if (parent === dir) return workspaceRoot;
    dir = parent;
  }
}

/** Local `path = "..."` dependencies declared under any dependencies/workspace/patch section of a
 *  Cargo.toml, plus `[workspace]` `members`/`exclude` entries -- a line-level scan (no TOML parser)
 *  that only collects path-bearing values, so registry deps (`crates.io` names) never leak in. */
function readRustDeps(root: string): string[] {
  const content = readProjectFile(root, ConfigFilenames.CARGO_TOML);
  if (content === undefined) return [];
  const deps: string[] = [];
  let section = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      section = header[1].trim().toLowerCase();
      continue;
    }
    if (section === "workspace") {
      for (const member of line.matchAll(/"([^"]+)"/g)) deps.push(member[1]);
      continue;
    }
    if (
      section.includes("dependencies") ||
      section.startsWith("patch") ||
      section.startsWith("replace")
    ) {
      for (const pathDep of line.matchAll(/path\s*=\s*"([^"]+)"/g)) {
        deps.push(pathDep[1]);
      }
    }
  }
  return deps.map((d) => resolveDepDir(root, d));
}

/** Local `replace <module> => <local-path>` directives in a go.mod -- only the local-path form
 *  (registry `require`s carry versions and can't be local). */
function readGoDeps(root: string): string[] {
  const content = readProjectFile(root, ConfigFilenames.GO_MOD);
  if (content === undefined) return [];
  const deps: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const match = rawLine.trim().match(/^replace\s+\S+\s+=>\s+(\S+)\s*$/);
    if (!match) continue;
    const localPath = match[1];
    if (!localPath.startsWith(".") && !path.isAbsolute(localPath)) continue;
    deps.push(localPath);
  }
  return deps.map((d) => resolveDepDir(root, d));
}

/** `workspaces`/`references`/`extends` path deps of a TypeScript project -- the monorepo boundary
 *  a root package.json declares and the tsconfig project references a sub-package declares. */
function readTypeScriptDeps(root: string): string[] {
  return [
    ...readTypeScriptWorkspaces(root),
    ...readTypeScriptTsconfigDeps(root),
  ];
}

/** Expands one `workspaces` pattern: a literal path, or a `*` glob against the directory's
 *  immediate entries. Never throws -- an unreadable/unmatched pattern contributes nothing. */
function expandWorkspacePattern(root: string, pattern: string): string[] {
  if (!pattern.includes("*")) return [path.resolve(root, pattern)];
  const parent = path.resolve(root, path.dirname(pattern));
  const base = path.basename(pattern);
  try {
    return fs
      .readdirSync(parent)
      .filter(
        (entry) =>
          base === "*" || entry.includes(base.slice(0, base.indexOf("*"))),
      )
      .map((entry) => path.join(parent, entry));
  } catch {
    return [];
  }
}

/** Local `workspaces` package directories of a root package.json. */
function readTypeScriptWorkspaces(root: string): string[] {
  const packageJson = readJson(root, ConfigFilenames.PACKAGE_JSON);
  if (packageJson === undefined) return [];
  const workspaces: unknown = packageJson.workspaces;
  const patterns: unknown = Array.isArray(workspaces)
    ? workspaces
    : typeof workspaces === "object" &&
        workspaces !== null &&
        Array.isArray((workspaces as { packages?: unknown }).packages)
      ? (workspaces as { packages?: unknown }).packages
      : [];
  const deps: string[] = [];
  for (const pattern of patterns as unknown[]) {
    if (typeof pattern === "string") {
      deps.push(...expandWorkspacePattern(root, pattern));
    }
  }
  return deps;
}

/** Local tsconfig project `references` paths and `extends` targets of a sub-package. */
function readTypeScriptTsconfigDeps(root: string): string[] {
  const tsconfig = readJson(root, ConfigFilenames.TSCONFIG_JSON);
  if (tsconfig === undefined) return [];
  const deps: string[] = [];
  const references = tsconfig.references;
  if (Array.isArray(references)) {
    for (const ref of references) {
      if (typeof ref !== "object" || ref === null) continue;
      const refPath = (ref as { path?: unknown }).path;
      if (typeof refPath === "string") deps.push(path.resolve(root, refPath));
    }
  }
  const extendsPath = tsconfig.extends;
  if (typeof extendsPath === "string") {
    deps.push(path.resolve(root, extendsPath));
  }
  return deps;
}

/** `<ProjectReference Include="...">` targets of every `*.csproj` in the project root -- resolved
 *  to the referenced project's *directory* (the owning-project root, which is where its own marker
 *  lives), not the .csproj file. */
function readCSharpDeps(root: string): string[] {
  const deps: string[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return deps;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".csproj")) continue;
    const content = readProjectFile(root, entry);
    if (content === undefined) continue;
    for (const match of content.matchAll(
      /<ProjectReference[^>]*Include\s*=\s*"([^"]+)"/g,
    )) {
      const resolved = path.resolve(root, match[1].split("\\").join("/"));
      deps.push(path.dirname(resolved));
    }
  }
  return deps;
}

function readProjectFile(root: string, name: string): string | undefined {
  try {
    return fs.readFileSync(path.join(root, name), "utf8");
  } catch {
    return undefined;
  }
}

function readJson(
  root: string,
  name: string,
): Record<string, unknown> | undefined {
  const content = readProjectFile(root, name);
  if (content === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveDepDir(root: string, relPath: string): string {
  return path.normalize(path.resolve(root, relPath));
}

/** Local path dependencies of a project root, per language (PRJ-003's edges). Languages without a
 *  cheap path-dep marker (python/java/cpp/php/ruby) contribute no deps -- project *boundaries*
 *  still apply to them (PRJ-001), only ordering is flat. */
function readProjectDeps(root: string, languageId: TierBLanguageId): string[] {
  switch (languageId) {
    case TIER_B_LANGUAGE_IDS.RUST:
      return readRustDeps(root);
    case TIER_B_LANGUAGE_IDS.GO:
      return readGoDeps(root);
    case TIER_B_LANGUAGE_IDS.TYPESCRIPT:
      return readTypeScriptDeps(root);
    case TIER_B_LANGUAGE_IDS.CSHARP:
      return readCSharpDeps(root);
    default:
      return [];
  }
}

/** Topological sort of the project groups, dependency-first, with a deterministic path-order
 *  tiebreak so a dependency cycle still terminates in a stable order (PRJ-003). Deps not present in
 *  this batch's own group set are ignored (they're either outside the workspace or empty this run). */
function orderGroups(groups: TierBProjectGroup[]): TierBProjectGroup[] {
  const indexByRoot = new Map(groups.map((g, i) => [g.root, i]));
  const dependentsOf = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const group of groups) {
    const deps = [...new Set(group.deps.filter((d) => d !== group.root))]
      .filter((d) => indexByRoot.has(d))
      .sort();
    indegree.set(group.root, deps.length);
    for (const dep of deps) {
      const dependents = dependentsOf.get(dep) ?? [];
      dependents.push(group.root);
      dependentsOf.set(dep, dependents);
    }
  }

  const ready = groups
    .filter((g) => indegree.get(g.root) === 0)
    .map((g) => g.root)
    .sort();
  const ordered: TierBProjectGroup[] = [];
  const visited = new Set<string>();

  while (ready.length > 0) {
    const root = ready.shift() as string;
    if (visited.has(root)) continue;
    visited.add(root);
    ordered.push(groups[indexByRoot.get(root) as number]);
    for (const dependent of (dependentsOf.get(root) ?? []).sort()) {
      if (visited.has(dependent)) continue;
      indegree.set(dependent, (indegree.get(dependent) as number) - 1);
      if (indegree.get(dependent) === 0) ready.push(dependent);
    }
    ready.sort();
  }

  const leftover = groups
    .filter((g) => !visited.has(g.root))
    .sort((a, b) => a.root.localeCompare(b.root));
  return [...ordered, ...leftover];
}

/**
 * PRJ-001 + PRJ-003: partitions one language bucket's files into owning-project groups (each file
 * maps to the nearest ancestor containing the language's project marker, else the workspace root)
 * and orders those groups dependency-first. Pure file-system logic -- no LSP server involvement --
 * so the provider's project-aware partition (Slice 2) and any caller can share the same
 * boundary/order decision instead of re-deriving it.
 */
export function partitionTierBBucket(
  input: PartitionTierBBucketInput,
): TierBProjectPartition {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const rule =
    PROJECT_MARKER_RULES.find((r) => r.languageId === input.languageId) ?? null;
  const markerCache = new Map<string, boolean>();
  const rootToFiles = new Map<string, string[]>();
  const fileToProjectRoot = new Map<string, string>();

  for (const file of input.files) {
    const root = rule
      ? findOwningProjectRoot(workspaceRoot, file, rule, markerCache)
      : workspaceRoot;
    fileToProjectRoot.set(file, root);
    const owned = rootToFiles.get(root);
    if (owned) owned.push(file);
    else rootToFiles.set(root, [file]);
  }

  const groups: TierBProjectGroup[] = [];
  for (const [root, files] of rootToFiles) {
    groups.push({
      root,
      files,
      deps: rule ? readProjectDeps(root, input.languageId) : [],
    });
  }

  return { groups: orderGroups(groups), fileToProjectRoot };
}
