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

  constructor(private workspaceRoot: string) {}

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

    // Aliases like @workspace/...
    if (modulePath.startsWith("@workspace/")) {
      const parts = modulePath.split("/");
      const pkg = parts[1];
      const rest = parts.slice(2).join("/"); // could be empty

      // We check artifacts/ and lib/
      const possibleRoots = [`artifacts/${pkg}/src`, `lib/${pkg}/src`];

      for (const root of possibleRoots) {
        const targetPath = rest ? path.posix.join(root, rest) : root;
        const resolved = this.findFileWithExtension(targetPath);
        if (resolved) return resolved;
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
