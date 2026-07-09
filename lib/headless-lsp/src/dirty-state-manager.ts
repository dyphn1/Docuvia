import { VirtualFileSystem } from "./vfs.js";
import path from "node:path";
import { createRequire } from "node:module";
import { Parser } from "web-tree-sitter";
import { loadDefaultRegistry } from "@workspace/plugins-ast";
import { generateAst } from "@workspace/ast-core";

const require = createRequire(import.meta.url);

export class DirtyStateManager {
  private vfs: VirtualFileSystem;
  private pendingChanges: Set<string>;
  private parserInitialized = false;

  constructor(workspaceRoot: string) {
    this.vfs = new VirtualFileSystem(workspaceRoot);
    this.pendingChanges = new Set();
  }

  async initialize(): Promise<void> {
    await this.vfs.initialize();
  }

  private async initParserIfNeeded(): Promise<void> {
    if (!this.parserInitialized) {
      try {
        const wasmPath = path.join(
          path.dirname(require.resolve("web-tree-sitter")),
          "web-tree-sitter.wasm"
        );
        await Parser.init({ locateFile: () => wasmPath });
        this.parserInitialized = true;
      } catch (e) {
        console.warn("Failed to initialize web-tree-sitter:", e);
      }
    }
  }

  async markDirty(uri: string, content: string): Promise<void> {
    await this.vfs.updateFile(uri, content);
    this.pendingChanges.add(uri);

    try {
      await this.invokeAstParser(uri, content);
    } catch (error) {
      console.warn(`Failed to parse AST for ${uri}:`, error);
    }
  }

  private async invokeAstParser(uri: string, content: string): Promise<void> {
    await this.initParserIfNeeded();
    if (!this.parserInitialized) return;

    let filePath = uri;
    if (uri.startsWith("file://")) {
      if (process.platform === "win32") {
        filePath = uri.replace("file:///", "").replace(/\//g, "\\");
        filePath = decodeURIComponent(filePath);
      } else {
        filePath = decodeURIComponent(uri.replace("file://", ""));
      }
    }

    const ext = path.extname(filePath);
    if (!ext) return;

    const registry = await loadDefaultRegistry();
    const provider = registry.getProviderForExtension(ext);
    if (!provider) return;

    const wasmLoader = async (wasmFile: string) => {
      const pkgName = wasmFile.replace(".wasm", "");
      try {
        const pkgMain = require.resolve(pkgName + "/package.json");
        return path.join(path.dirname(pkgMain), wasmFile);
      } catch (e) {
        // Fallback for tree-sitter-c_sharp which is in tree-sitter-c-sharp
        const altPkgName = pkgName.replace("_", "-");
        const pkgMain = require.resolve(altPkgName + "/package.json");
        return path.join(path.dirname(pkgMain), wasmFile);
      }
    };

    const astStream = generateAst(content, filePath, ext, registry, wasmLoader);
    const nodes: string[] = [];
    const edges: string[] = [];

    for await (const event of astStream) {
      if (event.type === "file" || event.type === "class" || event.type === "function") {
        const eventCopy: any = { ...event };
        delete eventCopy.type;

        nodes.push(
          JSON.stringify({
            id: (event as any).fqn || filePath,
            type: event.type,
            name: (event as any).name || path.basename(filePath),
            filePath: filePath,
            ...eventCopy,
          })
        );
      } else if ((event.type as string) === "calls" || (event.type as string) === "depends_on") {
        edges.push(JSON.stringify(event));
      }
    }

    if (nodes.length > 0 || edges.length > 0) {
      await this.vfs.writeAst(nodes, edges);
    }
  }

  async markClean(uri: string): Promise<void> {
    this.pendingChanges.delete(uri);
    await this.vfs.removeFile(uri);
  }

  getDirtyFiles(): string[] {
    return Array.from(this.pendingChanges);
  }

  hasDirtyFiles(): boolean {
    return this.pendingChanges.size > 0;
  }
}
