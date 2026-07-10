import { VirtualFileSystem, uriToFilePath } from "./vfs.js";
import path from "node:path";
import { createRequire } from "node:module";
import { Parser } from "web-tree-sitter";
import { loadDefaultRegistry } from "@workspace/plugins-ast";
import { generateAst, type LanguageRegistry } from "@workspace/ast-core";

const require = createRequire(import.meta.url);

const NODE_EVENT_TYPES = new Set(["file", "class", "function"]);
const EDGE_EVENT_TYPES = new Set(["calls", "depends_on"]);

export class DirtyStateManager {
  private vfs: VirtualFileSystem;
  private pendingChanges: Set<string>;
  private parserInitialized = false;
  private registry: LanguageRegistry | null = null;
  private wasmPathCache = new Map<string, string>();

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

  private async getRegistry(): Promise<LanguageRegistry> {
    if (!this.registry) {
      this.registry = await loadDefaultRegistry();
    }
    return this.registry;
  }

  private resolveWasmPath(wasmFile: string): string {
    const cached = this.wasmPathCache.get(wasmFile);
    if (cached) return cached;

    const pkgName = wasmFile.replace(".wasm", "");
    let pkgMain: string;
    try {
      pkgMain = require.resolve(pkgName + "/package.json");
    } catch (e) {
      // Fallback for tree-sitter-c_sharp which is in tree-sitter-c-sharp
      const altPkgName = pkgName.replace("_", "-");
      pkgMain = require.resolve(altPkgName + "/package.json");
    }

    const resolved = path.join(path.dirname(pkgMain), wasmFile);
    this.wasmPathCache.set(wasmFile, resolved);
    return resolved;
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

    const filePath = uriToFilePath(uri);
    const ext = path.extname(filePath);
    if (!ext) return;

    const registry = await this.getRegistry();
    const provider = registry.getProviderForExtension(ext);
    if (!provider) return;

    const wasmLoader = async (wasmFile: string) => this.resolveWasmPath(wasmFile);

    const astStream = generateAst(content, filePath, ext, registry, wasmLoader);
    const nodes: string[] = [];
    const edges: string[] = [];

    for await (const event of astStream) {
      if (NODE_EVENT_TYPES.has(event.type)) {
        const { type, ...rest } = event as any;
        nodes.push(
          JSON.stringify({
            id: (event as any).fqn || filePath,
            type,
            name: (event as any).name || path.basename(filePath),
            filePath,
            ...rest,
          })
        );
      } else if (EDGE_EVENT_TYPES.has(event.type as string)) {
        edges.push(JSON.stringify(event));
      }
    }

    await this.vfs.writeAst(nodes, edges);
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
