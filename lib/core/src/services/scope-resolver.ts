import * as path from "path";
import * as fs from "fs";

export interface ImportDescriptor {
  localName: string;
  originalName: string;
  modulePath: string;
}

/** Strips // and /* *\/ comments from JSONC content (e.g. tsconfig.json) so it can be JSON.parse'd. */
function stripJsonComments(content: string): string {
  return content.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? "" : m));
}

export class ScopeResolver {
  private exportsByFile: Map<string, Set<string>> = new Map();
  private importsByFile: Map<string, ImportDescriptor[]> = new Map();
  private localsByFile: Map<string, Set<string>> = new Map();
  private tsConfigPaths: Record<string, string[]> = {};

  constructor(private workspaceRoot: string) {
    this.loadTsConfigPaths();
  }

  private loadTsConfigPaths() {
    try {
      const tsconfigPath = path.join(this.workspaceRoot, "tsconfig.json");
      if (fs.existsSync(tsconfigPath)) {
        const content = fs.readFileSync(tsconfigPath, "utf-8");
        const cleanContent = stripJsonComments(content);
        try {
          const parsed = JSON.parse(cleanContent);
          if (parsed.compilerOptions && parsed.compilerOptions.paths) {
            this.tsConfigPaths = { ...this.tsConfigPaths, ...parsed.compilerOptions.paths };
          }
        } catch (e) {
          console.error("JSON parse error:", e);
        }
      }

      const tsconfigBasePath = path.join(this.workspaceRoot, "tsconfig.base.json");
      if (fs.existsSync(tsconfigBasePath)) {
        const content = fs.readFileSync(tsconfigBasePath, "utf-8");
        const cleanContent = stripJsonComments(content);
        const parsed = JSON.parse(cleanContent);
        if (parsed.compilerOptions && parsed.compilerOptions.paths) {
          this.tsConfigPaths = { ...parsed.compilerOptions.paths, ...this.tsConfigPaths };
        }
      }
    } catch (e: any) {
      // Ignore fs read or parse failures
      console.debug(
        `[ScopeResolver] Failed to read or parse tsconfig files: ${e.message || String(e)}`
      );
    }
  }

  public registerFile(
    filePath: string,
    imports: ImportDescriptor[],
    exports: string[],
    locals: string[]
  ) {
    // We store using relative paths to workspace root, using posix forward slashes
    const normalizedPath = filePath.replace(/\\/g, "/");
    this.importsByFile.set(normalizedPath, imports);
    this.exportsByFile.set(normalizedPath, new Set(exports));
    this.localsByFile.set(normalizedPath, new Set(locals));
  }

  public resolveCall(
    sourceFilePath: string,
    callName: string
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
        const resolvedPath = this.resolveModulePath(normalizedSource, imp.modulePath);
        if (resolvedPath) {
          return {
            targetFile: resolvedPath,
            targetSymbol: imp.originalName === "*" ? callName : imp.originalName,
          };
        }
      }
    }

    return null;
  }

  private resolveModulePath(sourceFile: string, modulePath: string): string | null {
    // Relative paths
    if (modulePath.startsWith(".")) {
      const dir = path.posix.dirname(sourceFile);
      const target = path.posix.join(dir, modulePath);
      return this.findFileWithExtension(target);
    }

    // Dynamic path resolution from tsconfig compilerOptions.paths
    for (const [alias, paths] of Object.entries(this.tsConfigPaths)) {
      const aliasPattern = alias.replace("*", "");
      if (modulePath.startsWith(aliasPattern)) {
        const match = modulePath.slice(aliasPattern.length);
        for (const p of paths) {
          const targetPath = p.replace("*", match);
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
      const starIdx = glob.indexOf("*");
      const baseDir = (starIdx >= 0 ? glob.slice(0, starIdx) : glob).replace(/\/$/, "");
      const fullBaseDir = path.join(this.workspaceRoot, baseDir);
      if (!fs.existsSync(fullBaseDir)) continue;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(fullBaseDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkgJsonPath = path.join(fullBaseDir, entry.name, "package.json");
        if (!fs.existsSync(pkgJsonPath)) continue;
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
          if (pkgJson.name) {
            cache.set(pkgJson.name, path.posix.join(baseDir, entry.name));
          }
        } catch {
          // Ignore unreadable/invalid package.json
        }
      }
    }
    this.packageDirCache = cache;
    return cache;
  }

  /** Reads pnpm-workspace.yaml or package.json#workspaces to find monorepo package globs. */
  private getWorkspaceGlobs(): string[] {
    try {
      const pnpmWsPath = path.join(this.workspaceRoot, "pnpm-workspace.yaml");
      if (fs.existsSync(pnpmWsPath)) {
        const content = fs.readFileSync(pnpmWsPath, "utf-8");
        const block = /packages:\s*\n((?:\s*-\s+.+\n?)+)/.exec(content);
        if (block) {
          const globs = [...block[1].matchAll(/^\s*-\s+["']?([^"'\n#]+?)["']?\s*$/gm)].map((m) =>
            m[1].trim()
          );
          if (globs.length > 0) return globs;
        }
      }

      const pkgJsonPath = path.join(this.workspaceRoot, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        if (Array.isArray(pkgJson.workspaces)) return pkgJson.workspaces;
        if (Array.isArray(pkgJson.workspaces?.packages)) return pkgJson.workspaces.packages;
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
    const workspaceDir = this.getWorkspacePackageDirs().get(pkgName);
    if (workspaceDir) {
      const entryTarget = subpath
        ? path.posix.join(workspaceDir, subpath)
        : path.posix.join(workspaceDir, "src", "index");
      const resolved = this.findFileWithExtension(entryTarget);
      if (resolved) return resolved;
      // Fall back to the package root itself if no conventional entry point is found
      const rootResolved = this.findFileWithExtension(workspaceDir);
      if (rootResolved) return rootResolved;
    }

    // 2. External npm dependency — read its package.json main/module entry point
    try {
      const pkgJsonPath = path.join(this.workspaceRoot, "node_modules", pkgName, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        const entry: string = subpath || pkgJson.module || pkgJson.main || "index.js";
        const relPath = path.posix.join("node_modules", pkgName, entry);
        if (fs.existsSync(path.join(this.workspaceRoot, relPath))) return relPath;
      }
    } catch {
      // Ignore unreadable/invalid package.json
    }

    return null;
  }

  private findFileWithExtension(basePath: string): string | null {
    const fullBasePath = path.join(this.workspaceRoot, basePath);
    if (fs.existsSync(fullBasePath) && fs.statSync(fullBasePath).isFile()) return basePath;

    const exts = [
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
    for (const ext of exts) {
      if (fs.existsSync(fullBasePath + ext)) return basePath + ext;
    }
    const indexExts = ["/index.ts", "/index.js"];
    for (const ext of indexExts) {
      if (fs.existsSync(fullBasePath + ext)) return basePath + ext;
    }
    return null; // unresolved
  }
}
