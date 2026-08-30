import * as path from "path";
import * as fs from "fs";
import type { ILogger } from "@workspace/contracts";
import {
  createNoopLogger,
  NODE_MODULES_DIR_NAME,
  UTF8_ENCODING,
} from "@workspace/contracts";
import { ConfigFilenames } from "../discovery/discovery-constants.js";
import { readFileWithinRoot, resolveWithinRoot } from "../utils/safe-fs.js";

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

/** Go source file extension — used to gate the directory-scoped same-package fallback in
 *  `resolveCall`/`resolveGoSamePackageCall` below (roadmap item 19). */
const GO_FILE_EXTENSION = ".go";

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

/** Node's explicit builtin-module protocol (`import { readFile } from "node:fs"`) — an
 *  unambiguous "this leaves the project" marker for `isExternalBinding` (issue #230). */
const NODE_BUILTIN_PROTOCOL_PREFIX = "node:";

/** Leading `@scope/name` (or bare `name`) segment of a module specifier, used to test a
 *  subpath import (`@workspace/contracts/testing`) against the workspace package list. */
const PACKAGE_NAME_PATTERN = /^(@[^/]+\/[^/]+|[^/]+)/;

export class ScopeResolver {
  private exportsByFile: Map<string, Set<string>> = new Map();
  private importsByFile: Map<string, ImportDescriptor[]> = new Map();
  private localsByFile: Map<string, Set<string>> = new Map();
  private tsConfigPaths: Record<string, string[]> = {};
  private goFilesByDirectory: Map<string, Set<string>> = new Map();

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

    if (normalizedPath.endsWith(GO_FILE_EXTENSION)) {
      const dir = path.posix.dirname(normalizedPath);
      let siblings = this.goFilesByDirectory.get(dir);
      if (!siblings) {
        siblings = new Set();
        this.goFilesByDirectory.set(dir, siblings);
      }
      siblings.add(normalizedPath);
    }
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
      if (imp.localName !== callName) continue;
      const resolved = this.resolveImportedBinding(
        normalizedSource,
        imp,
        callName,
      );
      if (resolved) return resolved;
    }

    // 3. Go packages are directory-scoped: check for a same-directory sibling `.go` file that
    // declares this symbol with no explicit import (see resolveGoSamePackageCall's doc comment).
    if (normalizedSource.endsWith(GO_FILE_EXTENSION)) {
      const goResult = this.resolveGoSamePackageCall(
        normalizedSource,
        callName,
      );
      if (goResult) return goResult;
    }

    return null;
  }

  /** Resolves one matched import descriptor to its defining file: module-path resolution
   * followed by barrel re-export chaining (issue #192 gap 2), falling back to the resolved
   * file itself -- the prior behavior floor -- when the chain dead-ends. */
  private resolveImportedBinding(
    normalizedSource: string,
    imp: ImportDescriptor,
    callName: string,
  ): { targetFile: string; targetSymbol: string } | null {
    const resolvedPath = this.resolveModulePath(
      normalizedSource,
      imp.modulePath,
    );
    if (!resolvedPath) return null;

    const targetSymbol =
      imp.originalName === WILDCARD_IMPORT_MARKER ? callName : imp.originalName;
    return (
      this.resolveReexportTarget(
        normalizedSource,
        resolvedPath,
        targetSymbol,
      ) ?? {
        targetFile: resolvedPath,
        targetSymbol,
      }
    );
  }

  /**
   * Issue #192 root-cause fix -- member-call resolution (`obj.method()`, `this.method()`).
   * `resolveCall` only ever saw bare names, so every OOP-style call was structurally
   * unresolvable (~43% of this repo's own unresolved sites were member/this receivers).
   * Precision-first ladder, same "unique-or-refuse" discipline as CRG's scoped_resolver:
   *
   * 1. **this/super receiver** -> the callee must be a same-file symbol (a method of an
   *    enclosing/derived class). Same-file scoping keeps a wrong match cheap.
   * 2. **import-binding receiver** -> the receiver identifier is a known import local name
   *    (e.g. `import { docuviaFactory } ...; docuviaFactory.register(...)`): resolve the
   *    binding's defining module, then look the callee up as a local/exported symbol there,
   *    following barrel re-export chains exactly like a bare import would.
   * 3. **same-file static/local-object fallback** -> `ClassName.staticFn()` or a helper
   *    object calling into its own file's symbols. Only consulted for receivers that are
   *    neither this/super nor imports, and only within the caller's own file.
   *
   * Deliberately NOT covered (stays unresolved rather than guessed): receivers bound to local
   * variables whose type comes from another module's exports without a direct import binding
   * (`const s = makeStore(); s.commit()`) -- that needs real type inference. Unknown-receiver
   * calls are never matched project-wide (the `Add`/`Close` false-match hazard is why
   * `useNameFallback` is implements/extends-only).
   */
  public resolveMemberCall(
    sourceFilePath: string,
    receiverText: string,
    calleeName: string,
  ): { targetFile: string; targetSymbol: string } | null {
    const normalizedSource = sourceFilePath.replace(/\\/g, "/");

    // 1. this/super -> same-file method.
    if (receiverText === "this" || receiverText === "super") {
      if (this.localsByFile.get(normalizedSource)?.has(calleeName)) {
        return { targetFile: normalizedSource, targetSymbol: calleeName };
      }
      return null;
    }

    // 2. Receiver is an imported binding -> method lives in the binding's defining module.
    const viaImport = this.resolveImportReceiverMethod(
      normalizedSource,
      receiverText,
      calleeName,
    );
    if (viaImport) return viaImport;

    // 3. Same-file static/local-object heuristic.
    if (this.localsByFile.get(normalizedSource)?.has(calleeName)) {
      return { targetFile: normalizedSource, targetSymbol: calleeName };
    }

    return null;
  }

  /** Ladder step 2 of `resolveMemberCall`: when the receiver identifier is a known import
   *  local name, resolve the binding's module and look the callee up there (following barrel
   *  re-export chains like a bare import would). */
  private resolveImportReceiverMethod(
    normalizedSource: string,
    receiverText: string,
    calleeName: string,
  ): { targetFile: string; targetSymbol: string } | null {
    const imports = this.importsByFile.get(normalizedSource) || [];
    for (const imp of imports) {
      if (imp.localName !== receiverText) continue;
      const bindingFile = this.resolveModulePath(
        normalizedSource,
        imp.modulePath,
      );
      if (!bindingFile) continue;
      const viaReexport = this.resolveReexportTarget(
        normalizedSource,
        bindingFile,
        calleeName,
      );
      if (viaReexport) return viaReexport;
      if (this.localsByFile.get(bindingFile)?.has(calleeName)) {
        return { targetFile: bindingFile, targetSymbol: calleeName };
      }
      const viaReceiverDecl = this.resolveMethodAtReceiverDeclaration(
        normalizedSource,
        imp,
        receiverText,
        calleeName,
        bindingFile,
      );
      if (viaReceiverDecl) return viaReceiverDecl;
      // The binding resolved but doesn't declare the callee (e.g. namespace object holding
      // re-exported members): keep scanning other same-named bindings, else fall through.
    }
    return null;
  }

  /**
   * Issue #230's real-recall half. The two lookups above resolve the receiver's *module* and
   * then hunt the callee inside it — which structurally cannot work when the module is a barrel:
   * `import { docuviaFactory } from "@workspace/contracts"` resolves to
   * `lib/contracts/src/index.ts`, and `register` is declared nowhere near it. The receiver
   * *symbol* was never chased, so all 379 `docuviaFactory.register(...)` sites (30 files) plus
   * `docuviaFactory.lock/resolve` and `docuviaMemory.set/get/createScope` silently dropped.
   *
   * So: follow the receiver binding itself down the re-export chain to the file that actually
   * declares it (`lib/contracts/src/factory/docuvia-factory.ts`, `export const docuviaFactory =
   * new DocuviaFactory()`), then look the callee up as a local there — class methods are
   * registered as locals (`persist-ast-graph.ts`'s `registerResolverFiles` pushes every
   * `functions` entry, methods included), so `register` hits its own method node.
   *
   * Same unique-or-refuse discipline as the rest of the ladder: the callee must be declared in
   * the receiver's own declaring file. A receiver that resolves to a file not declaring the
   * callee stays unresolved rather than falling back to the file node — an instance method that
   * lives on a base class in a third file is left to Tier B, not guessed at.
   */
  private resolveMethodAtReceiverDeclaration(
    normalizedSource: string,
    imp: ImportDescriptor,
    receiverText: string,
    calleeName: string,
    bindingFile: string,
  ): { targetFile: string; targetSymbol: string } | null {
    const receiverSymbol =
      imp.originalName === WILDCARD_IMPORT_MARKER
        ? receiverText
        : imp.originalName;
    const declaration = this.resolveReexportTarget(
      normalizedSource,
      bindingFile,
      receiverSymbol,
    );
    if (!declaration) return null;
    if (!this.localsByFile.get(declaration.targetFile)?.has(calleeName)) {
      return null;
    }
    return { targetFile: declaration.targetFile, targetSymbol: calleeName };
  }

  /**
   * Issue #230: does this file's binding for `bindingName` provably leave the analyzed project?
   * Drives `GraphPersisterService`'s `external` counter — see `CallResolutionStats.external` for
   * why those sites are excluded from health denominators instead of counted as failures.
   *
   * Returns false (i.e. "not provably external", so a still-unresolved site stays a real gap)
   * for every in-project shape: a relative specifier, a workspace sibling package, and a
   * tsconfig-path alias. A workspace-package *subpath* that fails to resolve
   * (`@workspace/contracts/testing`, 20 sites here) is deliberately kept as a resolver gap
   * rather than laundered into `external`.
   */
  public isExternalBinding(
    sourceFilePath: string,
    bindingName: string,
  ): boolean {
    const normalizedSource = sourceFilePath.replace(/\\/g, "/");
    const imports = this.importsByFile.get(normalizedSource) || [];
    return imports.some(
      (imp) =>
        imp.localName === bindingName &&
        this.isExternalSpecifier(normalizedSource, imp.modulePath),
    );
  }

  /** Whether `sourceFilePath` has any import binding under this local name (issue #230) —
   *  distinguishes "callee is an ambient global" from "callee is an unresolved import". */
  public hasBinding(sourceFilePath: string, bindingName: string): boolean {
    return (
      this.importsByFile.get(sourceFilePath.replace(/\\/g, "/")) ?? []
    ).some((imp) => imp.localName === bindingName);
  }

  /** Whether `name` is a symbol declared in `sourceFilePath` itself (issue #230) — the same
   *  `localsByFile` view `resolveCall` step 1 consults, exposed for call-origin classification. */
  public declaresLocal(sourceFilePath: string, name: string): boolean {
    return (
      this.localsByFile.get(sourceFilePath.replace(/\\/g, "/"))?.has(name) ??
      false
    );
  }

  /** Core of `isExternalBinding`: classifies one module specifier as inside/outside the project.
   *  Note there is no hardcoded builtin list — a bare specifier that is neither a workspace
   *  package nor a tsconfig alias nor a real `node_modules` directory (`"fs"`, `"path"`) falls
   *  through to the final `return true`, which is exactly the right answer for it. */
  private isExternalSpecifier(
    normalizedSource: string,
    modulePath: string,
  ): boolean {
    if (modulePath.startsWith(NODE_BUILTIN_PROTOCOL_PREFIX)) return true;
    // A relative specifier always names a file inside the analyzed tree; failing to resolve one
    // is a resolver bug, never evidence of externality.
    if (modulePath.startsWith(RELATIVE_IMPORT_PREFIX)) return false;

    const packageName = PACKAGE_NAME_PATTERN.exec(modulePath)?.[1];
    if (packageName && this.getWorkspacePackageDirs().has(packageName)) {
      return false;
    }
    if (this.matchesTsConfigAlias(modulePath)) return false;

    const resolved = this.resolveModulePath(normalizedSource, modulePath);
    if (!resolved) return true;
    return (
      resolved.startsWith(`${NODE_MODULES_DIR_NAME}/`) ||
      resolved.includes(`/${NODE_MODULES_DIR_NAME}/`)
    );
  }

  /** Whether `modulePath` is covered by a tsconfig `compilerOptions.paths` alias — an
   *  in-project mapping, so never `external` even when it fails to resolve. */
  private matchesTsConfigAlias(modulePath: string): boolean {
    return Object.keys(this.tsConfigPaths).some((alias) =>
      modulePath.startsWith(alias.replace(PATH_WILDCARD_TOKEN, "")),
    );
  }

  /**
   * Issue #192 gap 2: follows a barrel re-export chain (`export { X } from "./y"`, made visible
   * by edge-computer's export_statement descriptors) from `startFile` until the file that actually
   * declares `symbol` as a local. Bounded by a visited set seeded with `originFile` so mutually
   * recursive re-exports terminate. Returns null when the chain dead-ends (symbol defined
   * nowhere along it) -- callers fall back to the pre-chain behavior of targeting the barrel
   * itself, so this can only improve resolution, never regress it.
   */
  private resolveReexportTarget(
    originFile: string,
    startFile: string,
    startSymbol: string,
  ): { targetFile: string; targetSymbol: string } | null {
    let currentFile = startFile;
    let currentSymbol = startSymbol;
    const visitedFiles = new Set<string>([originFile]);
    while (!visitedFiles.has(currentFile)) {
      visitedFiles.add(currentFile);
      if (this.localsByFile.get(currentFile)?.has(currentSymbol)) {
        return { targetFile: currentFile, targetSymbol: currentSymbol };
      }
      const reexport = this.importsByFile
        .get(currentFile)
        ?.find((imp) => imp.localName === currentSymbol);
      if (!reexport) return null;
      const nextFile = this.resolveModulePath(currentFile, reexport.modulePath);
      if (!nextFile) return null;
      currentFile = nextFile;
      currentSymbol =
        reexport.originalName === WILDCARD_IMPORT_MARKER
          ? currentSymbol
          : reexport.originalName;
    }
    return null;
  }

  /** Go packages are directory-scoped: any function/type declared in *any* `.go` file in the
   *  same directory is callable from every other file in that directory with no `import`
   *  statement at all — the one cross-file call convention `resolveModulePath`'s import-based
   *  resolution structurally cannot see (roadmap item 19). Directory equality is a deliberate
   *  approximation of "same package," not a real `package` declaration comparison: an external
   *  test package (`package foo_test` in a `_test.go` file sharing `foo`'s directory) would be
   *  mismatched by this check, but Docuvia2 doesn't persist each file's actual package name
   *  anywhere today, and internal test packages (`package foo`, sharing the main package) are
   *  the overwhelmingly common convention — treated as an accepted imprecision, not chased
   *  further here. */
  private resolveGoSamePackageCall(
    normalizedSource: string,
    callName: string,
  ): { targetFile: string; targetSymbol: string } | null {
    const dir = path.posix.dirname(normalizedSource);
    const siblings = this.goFilesByDirectory.get(dir);
    if (!siblings) return null;
    for (const file of siblings) {
      if (file === normalizedSource) continue;
      if (this.localsByFile.get(file)?.has(callName)) {
        return { targetFile: file, targetSymbol: callName };
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
    // Issue #208: globs come from the analyzed workspace's own config files, so contain them.
    const fullBaseDir = resolveWithinRoot(this.workspaceRoot, baseDir);
    if (!fullBaseDir || !fs.existsSync(fullBaseDir)) return;

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
      const pnpmWsContent = readFileWithinRoot(
        this.workspaceRoot,
        PNPM_WORKSPACE_FILENAME,
      );
      if (pnpmWsContent) {
        const block = /packages:\s*\n((?:\s*-\s+.+\n?)+)/.exec(pnpmWsContent);
        if (block) {
          const globs = [
            ...block[1].matchAll(/^\s*-\s+["']?([^"'\n#]+?)["']?\s*$/gm),
          ].map((m) => m[1].trim());
          if (globs.length > 0) return globs;
        }
      }

      const pkgJsonContent = readFileWithinRoot(
        this.workspaceRoot,
        ConfigFilenames.PACKAGE_JSON,
      );
      if (pkgJsonContent) {
        const pkgJson = JSON.parse(pkgJsonContent);
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
      // Issue #208: pkgName comes from an arbitrary import specifier, so the joined path is
      // containment-checked before any fs access.
      const pkgJsonContent = readFileWithinRoot(
        this.workspaceRoot,
        path.join(NODE_MODULES_DIR_NAME, pkgName, ConfigFilenames.PACKAGE_JSON),
      );
      if (!pkgJsonContent) return null;

      const pkgJson = JSON.parse(pkgJsonContent);
      const entry: string =
        subpath ||
        pkgJson.module ||
        pkgJson.main ||
        DEFAULT_PACKAGE_ENTRY_FILENAME;
      const relPath = path.posix.join(NODE_MODULES_DIR_NAME, pkgName, entry);
      if (resolveWithinRoot(this.workspaceRoot, relPath)) return relPath;
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

  /** First of `candidates` (workspace-relative paths) whose containment-resolved absolute form
   *  exists — returns the candidate itself, or null. With `requireFile`, also demands a regular
   *  file (`statSync().isFile()`), mirroring the old exact-match branch. Keeps the containment
   *  check (issue #208) in one place so no candidate can bypass it. */
  private firstExisting(
    candidates: string[],
    requireFile = false,
  ): string | null {
    for (const rel of candidates) {
      const full = resolveWithinRoot(this.workspaceRoot, rel);
      if (!full || !fs.existsSync(full)) continue;
      if (requireFile && !fs.statSync(full).isFile()) continue;
      return rel;
    }
    return null;
  }

  private findFileWithExtension(basePath: string): string | null {
    const exact = this.firstExisting([basePath], true);
    if (exact) return exact;

    const withExt = this.firstExisting(
      RESOLVABLE_FILE_EXTENSIONS.map((ext) => basePath + ext),
    );
    if (withExt) return withExt;

    if (ScopeResolver.COMPILED_JS_EXTENSION_PATTERN.test(basePath)) {
      const stem = basePath.replace(
        ScopeResolver.COMPILED_JS_EXTENSION_PATTERN,
        "",
      );
      const stemHit = this.firstExisting(
        RESOLVABLE_FILE_EXTENSIONS.map((ext) => stem + ext),
      );
      if (stemHit) return stemHit;
    }

    return this.firstExisting(
      RESOLVABLE_INDEX_SUFFIXES.map((suffix) => basePath + suffix),
    );
  }
}
