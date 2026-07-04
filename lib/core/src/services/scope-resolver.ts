import * as path from "path";
import * as fs from "fs";

export interface ImportDescriptor {
  localName: string;
  originalName: string;
  modulePath: string;
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
        const cleanContent = content.replace(
          /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
          (m, g) => (g ? "" : m)
        );
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
        const cleanContent = content.replace(
          /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
          (m, g) => (g ? "" : m)
        );
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

    return null;
  }

  private findFileWithExtension(basePath: string): string | null {
    const fullBasePath = path.join(this.workspaceRoot, basePath);
    if (fs.existsSync(fullBasePath) && fs.statSync(fullBasePath).isFile()) return basePath;

    const exts = [".ts", ".js", ".tsx", ".jsx"];
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
