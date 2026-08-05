import * as path from "path";
import * as fs from "fs";
import type { ILogger } from "@workspace/contracts";
import { createNoopLogger, UTF8_ENCODING } from "@workspace/contracts";
import {
  ConfigFilenames,
  NODE_MODULES_DIR_NAME,
} from "../discovery/discovery-constants.js";

/**
 * Cross-file call/implements/extends edge resolution — the logic `persist-ast-graph.ts` uses
 * to turn a raw callee name into a concrete (file, symbol) pair.
 */
export interface ImportDescriptor {
  localName: string;
  originalName: string;
  modulePath: string;
}

/** Strips // and /* *\/ comments from JSONC content (e.g. tsconfig.json) so it can be JSON.parse'd. */
function stripJsonComments(content: string): string {
  return content.replace(
    /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
    (m, g) => (g ? "" : m),
  );
}

const TSCONFIG_BASE_FILENAME = "tsconfig.base.json";
const PNPM_WORKSPACE_FILENAME = "pnpm-workspace.yaml";
const DEFAULT_PACKAGE_ENTRY_FILENAME = "index.js";
/** Conventional entry-point segments (`<pkg>/src/index`) tried for a workspace-monorepo sibling
 *  package when its module path names no subpath of its own. */
const WORKSPACE_ENTRY_SRC_DIR = "src";
const WORKSPACE_ENTRY_BASENAME = "index";

/** Substitution token in tsconfig `compilerOptions.paths` aliases (e.g. `"@app/*": [...]`) and in
 *  pnpm workspace package globs (e.g. `"packages/*"`) — distinct from `WILDCARD_IMPORT_MARKER`
 *  below, which marks an unresolved *import binding*, not a path pattern. */
const PATH_WILDCARD_TOKEN = "*";

/** Leading character of a relative-import module path (`./foo`, `../foo`), distinguishing it from
 *  a tsconfig-path-aliased or bare-package import in `resolveModulePath`. */
const RELATIVE_IMPORT_PREFIX = ".";

/** Extensions tried, in order, when resolving an import that names no extension of its own. */
const RESOLVABLE_FILE_EXTENSIONS = [
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".cpp",
  ".cc",
  ".c",
  ".h",
  ".hpp",
];

/** Index-file suffixes tried when a bare directory import resolves to a package/folder. */
const RESOLVABLE_INDEX_SUFFIXES = ["/index.ts", "/index.js"];

const ScopeResolverMessages = {
  TSCONFIG_PARSE_FAILED: "Failed to JSON-parse tsconfig.json",
  TSCONFIG_FILES_READ_FAILED: "Failed to read or parse tsconfig files",
} as const;

/**
 * Marks namespace/default/whole-module import bindings that don't resolve to a real named
 * export — mirrors `@workspace/ast-core`'s private `WILDCARD_IMPORT_MARKER`
 * (`lib/ast-core/src/core/edge-computer.ts`), which is what actually produces
 * `ImportDescriptor.originalName: "*"` values this class consumes.
 */
const WILDCARD_IMPORT_MARKER = "*";

export class ScopeResolver {
  private exportsByFile: Map<string, Set<string>> = new Map();
  private importsByFile: Map<string, ImportDescriptor[]> = new Map();
  private localsByFile: Map<string, Set<string>> = new Map();
  private tsConfigPaths: Record<string, string[]> = {};

  constructor(
    private workspaceRoot: string,
    private readonly logger: ILogger = createNoopLogger(),
  ) {
    this.loadTsConfigPaths();
  }

  private loadTsConfigPaths() {
    try {
      this.mergeProjectTsConfigPaths();
      this.mergeBaseTsConfigPaths();
    } catch (e: any) {
      // Ignore fs read or parse failures
      this.logger.debug(ScopeResolverMessages.TSCONFIG_FILES_READ_FAILED, {
        error: e?.message ?? String(e),
      });
    }
  }

  /** Merges `tsconfig.json`'s `compilerOptions.paths`, with a JSON.parse failure here logged and
   *  swallowed (not fatal to `loadTsConfigPaths` as a whole) so a base tsconfig can still merge
   *  below. */
  private mergeProjectTsConfigPaths(): void {
    const tsconfigPath = path.join(
      this.workspaceRoot,
      ConfigFilenames.TSCONFIG_JSON,
    );
    if (!fs.existsSync(tsconfigPath)) return;

    const content = fs.readFileSync(tsconfigPath, UTF8_ENCODING);
    const cleanContent = stripJsonComments(content);
    try {
      const parsed = JSON.parse(cleanContent);
      if (parsed.compilerOptions && parsed.compilerOptions.paths) {
        this.tsConfigPaths = {
          ...this.tsConfigPaths,
          ...parsed.compilerOptions.paths,
        };
      }
    } catch (e) {
      this.logger.debug(ScopeResolverMessages.TSCONFIG_PARSE_FAILED, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Merges `tsconfig.base.json`'s `compilerOptions.paths` (lower precedence than the project
   *  tsconfig's — see the spread order below). Any failure here propagates to the outer
   *  `loadTsConfigPaths` try/catch, matching the original inline behavior. */
  private mergeBaseTsConfigPaths(): void {
    const tsconfigBasePath = path.join(
      this.workspaceRoot,
      TSCONFIG_BASE_FILENAME,
    );
    if (!fs.existsSync(tsconfigBasePath)) return;

    const content = fs.readFileSync(tsconfigBasePath, UTF8_ENCODING);
    const cleanContent = stripJsonComments(content);
    const parsed = JSON.parse(cleanContent);
    if (parsed.compilerOptions && parsed.compilerOptions.paths) {
      this.tsConfigPaths = {
        ...parsed.compilerOptions.paths,
        ...this.tsConfigPaths,
      };
    }
  }

  public registerFile(
    filePath: string,
    imports: ImportDescriptor[],
    exports: string[],
    locals: string[],
  ) {
    // We store using relative paths to workspace root, using posix forward slashes
    const normalizedPath = filePath.replace(/\\/g, "/");
    this.importsByFile.set(normalizedPath, imports);
    this.exportsByFile.set(normalizedPath, new Set(exports));
    this.localsByFile.set(normalizedPath, new Set(locals));
  }

  public resolveCall(
    sourceFilePath: string,
    callName: string,
  ): { targetFile: string; targetSymbol: string } | null {
    const normalizedSource = sourceFilePath.replace(/\\/g, "/");

    // 1. Check if it's local
    const locals = this.localsByFile.get(normalizedSource);
    if (locals && locals.has(callName)) {
      return { targetFile: normalizedSource, targetSymbol: callName };
    }

    // 2. Check if it's imported
    const imports = this.importsByFile.get(normalizedSource) || [];
    for (const imp of imports) {
      if (imp.localName === callName) {
        const resolvedPath = this.resolveModulePath(
          normalizedSource,
          imp.modulePath,
        );
        if (resolvedPath) {
          return {
            targetFile: resolvedPath,
            targetSymbol:
              imp.originalName === WILDCARD_IMPORT_MARKER
                ? callName
                : imp.originalName,
          };
        }
      }
    }

    return null;
  }

  /**
   * (Worker-spawn edge resolution, TS/JS only — see `ast-worker.ts`'s `collectWorkerSpawns`.)
   * Resolves a `new Worker(<path>)` spawn's literal relative-path argument — already known to be
   * directory-relative (e.g. from `path.resolve(__dirname, "./ast-worker.js")`) — to a real
   * workspace file, reusing `findFileWithExtension`'s extension-probing rather than duplicating
   * it (mirrors `resolveModulePath`'s own relative-path branch below). The pre-strip below is now
   * redundant with `findFileWithExtension`'s own compiled-`.js`-extension swap (see that method's
   * doc comment) but left in place since it's harmless and pre-dates that fix.
   */
  public resolveWorkerSpawnPath(
    sourceFile: string,
    relativePath: string,
  ): string | null {
    const dir = path.posix.dirname(sourceFile.replace(/\\/g, "/"));
    const target = path.posix.join(dir, relativePath.replace(/\.jsx?$/, ""));
    return this.findFileWithExtension(target);
  }

  private resolveModulePath(
    sourceFile: string,
    modulePath: string,
  ): string | null {
    // Relative paths
    if (modulePath.startsWith(RELATIVE_IMPORT_PREFIX)) {
      const dir = path.posix.dirname(sourceFile);
      const target = path.posix.join(dir, modulePath);
      return this.findFileWithExtension(target);
    }

    // Dynamic path resolution from tsconfig compilerOptions.paths
    for (const [alias, paths] of Object.entries(this.tsConfigPaths)) {
      const aliasPattern = alias.replace(PATH_WILDCARD_TOKEN, "");
      if (modulePath.startsWith(aliasPattern)) {
        const match = modulePath.slice(aliasPattern.length);
        for (const p of paths) {
          const targetPath = p.replace(PATH_WILDCARD_TOKEN, match);
          const resolved = this.findFileWithExtension(targetPath);
          if (resolved) return resolved;
        }
      }
    }

    // Bare package import (npm dependency or a workspace-monorepo sibling package)
    return this.resolveBareImport(modulePath);
  }

  private packageDirCache: Map<string, string> | null = null;

  /** Maps a package name (e.g. "@workspace/core") to its workspace-relative directory. */
  private getWorkspacePackageDirs(): Map<string, string> {
    if (this.packageDirCache) return this.packageDirCache;
    const cache = new Map<string, string>();
    for (const glob of this.getWorkspaceGlobs()) {
      this.collectPackageDirsForGlob(glob, cache);
    }
    this.packageDirCache = cache;
    return cache;
  }

  /** Scans one workspace glob's base directory for immediate subdirectories with a
   *  `package.json`, registering each into `cache`. */
  private collectPackageDirsForGlob(
    glob: string,
    cache: Map<string, string>,
  ): void {
    const starIdx = glob.indexOf(PATH_WILDCARD_TOKEN);
    const baseDir = (starIdx >= 0 ? glob.slice(0, starIdx) : glob).replace(
      /\/$/,
      "",
    );
    const fullBaseDir = path.join(this.workspaceRoot, baseDir);
    if (!fs.existsSync(fullBaseDir)) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(fullBaseDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      this.registerPackageDirEntry(baseDir, fullBaseDir, entry, cache);
    }
  }

  private registerPackageDirEntry(
    baseDir: string,
    fullBaseDir: string,
    entry: fs.Dirent,
    cache: Map<string, string>,
  ): void {
    if (!entry.isDirectory()) return;
    const pkgJsonPath = path.join(
      fullBaseDir,
      entry.name,
      ConfigFilenames.PACKAGE_JSON,
    );
    if (!fs.existsSync(pkgJsonPath)) return;
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, UTF8_ENCODING));
      if (pkgJson.name) {
        cache.set(pkgJson.name, path.posix.join(baseDir, entry.name));
      }
    } catch {
      // Ignore unreadable/invalid package.json
    }
  }

  /** Reads pnpm-workspace.yaml or package.json#workspaces to find monorepo package globs. */
  private getWorkspaceGlobs(): string[] {
    try {
      const pnpmWsPath = path.join(this.workspaceRoot, PNPM_WORKSPACE_FILENAME);
      if (fs.existsSync(pnpmWsPath)) {
        const content = fs.readFileSync(pnpmWsPath, UTF8_ENCODING);
        const block = /packages:\s*\n((?:\s*-\s+.+\n?)+)/.exec(content);
        if (block) {
          const globs = [
            ...block[1].matchAll(/^\s*-\s+["']?([^"'\n#]+?)["']?\s*$/gm),
          ].map((m) => m[1].trim());
          if (globs.length > 0) return globs;
        }
      }

      const pkgJsonPath = path.join(
        this.workspaceRoot,
        ConfigFilenames.PACKAGE_JSON,
      );
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, UTF8_ENCODING));
        if (Array.isArray(pkgJson.workspaces)) return pkgJson.workspaces;
        if (Array.isArray(pkgJson.workspaces?.packages))
          return pkgJson.workspaces.packages;
      }
    } catch {
      // Ignore fs/parse failures — not every project is a monorepo
    }
    return [];
  }

  private resolveBareImport(modulePath: string): string | null {
    const match = /^(@[^/]+\/[^/]+|[^/]+)(\/.*)?$/.exec(modulePath);
    if (!match) return null;
    const pkgName = match[1];
    const subpath = match[2]?.slice(1); // drop leading "/"

    // 1. Workspace-monorepo sibling package (e.g. "@workspace/core" -> lib/core)
    const workspaceResolved = this.resolveWorkspaceSiblingImport(
      pkgName,
      subpath,
    );
    if (workspaceResolved) return workspaceResolved;

    // 2. External npm dependency — read its package.json main/module entry point
    return this.resolveNodeModulesImport(pkgName, subpath);
  }

  private resolveWorkspaceSiblingImport(
    pkgName: string,
    subpath: string | undefined,
  ): string | null {
    const workspaceDir = this.getWorkspacePackageDirs().get(pkgName);
    if (!workspaceDir) return null;

    const entryTarget = subpath
      ? path.posix.join(workspaceDir, subpath)
      : path.posix.join(
          workspaceDir,
          WORKSPACE_ENTRY_SRC_DIR,
          WORKSPACE_ENTRY_BASENAME,
        );
    const resolved = this.findFileWithExtension(entryTarget);
    if (resolved) return resolved;
    // Fall back to the package root itself if no conventional entry point is found
    return this.findFileWithExtension(workspaceDir);
  }

  private resolveNodeModulesImport(
    pkgName: string,
    subpath: string | undefined,
  ): string | null {
    try {
      const pkgJsonPath = path.join(
        this.workspaceRoot,
        NODE_MODULES_DIR_NAME,
        pkgName,
        ConfigFilenames.PACKAGE_JSON,
      );
      if (!fs.existsSync(pkgJsonPath)) return null;

      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, UTF8_ENCODING));
      const entry: string =
        subpath ||
        pkgJson.module ||
        pkgJson.main ||
        DEFAULT_PACKAGE_ENTRY_FILENAME;
      const relPath = path.posix.join(NODE_MODULES_DIR_NAME, pkgName, entry);
      if (fs.existsSync(path.join(this.workspaceRoot, relPath))) return relPath;
      return null;
    } catch {
      // Ignore unreadable/invalid package.json
      return null;
    }
  }

  /**
   * `basePath` may already end in `.js`/`.jsx`/`.mjs`/`.cjs`: TS's NodeNext/ESM module
   * resolution requires relative specifiers to name the *compiled* extension even when the
   * real source is `.ts`/`.tsx` (e.g. `import { Disposable } from "./lifecycle.js"` resolving
   * to `lifecycle.ts` on disk) — a real, common convention (vscode's own source uses it
   * throughout), not an edge case. The plain append loop below never matches that shape (it
   * only ever adds extensions, producing `lifecycle.js.ts`), so every such import silently
   * failed to resolve and fell through to `persist-ast-graph.ts`'s project-wide name-based
   * fallback for implements/extends — collapsing every same-named class across the whole
   * codebase onto whichever node that fallback happened to rank first (confirmed against
   * `microsoft/vscode`: all `extends Disposable` edges pointed at one unrelated node instead of
   * splitting across each file's real imported `Disposable`). Previously worked around only for
   * worker-spawn resolution (`resolveWorkerSpawnPath`); fixed here at the shared root so every
   * relative-import caller benefits.
   */
  private static readonly COMPILED_JS_EXTENSION_PATTERN = /\.(m|c)?jsx?$/;

  private findFileWithExtension(basePath: string): string | null {
    const fullBasePath = path.join(this.workspaceRoot, basePath);
    if (fs.existsSync(fullBasePath) && fs.statSync(fullBasePath).isFile())
      return basePath;

    for (const ext of RESOLVABLE_FILE_EXTENSIONS) {
      if (fs.existsSync(fullBasePath + ext)) return basePath + ext;
    }

    if (ScopeResolver.COMPILED_JS_EXTENSION_PATTERN.test(basePath)) {
      const stem = basePath.replace(
        ScopeResolver.COMPILED_JS_EXTENSION_PATTERN,
        "",
      );
      const fullStem = path.join(this.workspaceRoot, stem);
      for (const ext of RESOLVABLE_FILE_EXTENSIONS) {
        if (fs.existsSync(fullStem + ext)) return stem + ext;
      }
    }

    for (const ext of RESOLVABLE_INDEX_SUFFIXES) {
      if (fs.existsSync(fullBasePath + ext)) return basePath + ext;
    }
    return null; // unresolved
  }
}
