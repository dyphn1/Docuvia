import fs from "node:fs/promises";
import path from "node:path";

export class VirtualFileSystem {
  private tempDir: string;
  private cache: Map<string, string>;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.tempDir = path.join(workspaceRoot, ".docuvia", "tmp");
    this.cache = new Map();
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  private getGitIsomorphicPath(uri: string): string {
    let filePath = uri;
    if (uri.startsWith("file://")) {
      if (process.platform === "win32") {
        filePath = uri.replace("file:///", "").replace(/\//g, "\\");
        filePath = decodeURIComponent(filePath);
      } else {
        filePath = decodeURIComponent(uri.replace("file://", ""));
      }
    }

    let relPath = path.relative(this.workspaceRoot, filePath);
    if (relPath.startsWith("..") || path.isAbsolute(relPath)) {
      // Fallback if outside workspace
      relPath =
        Buffer.from(uri)
          .toString("base64")
          .replace(/[\/+=]/g, "_") + ".tmp";
    }
    return relPath;
  }

  async updateFile(uri: string, content: string): Promise<void> {
    this.cache.set(uri, content);
    const relPath = this.getGitIsomorphicPath(uri);
    const tempFilePath = path.join(this.tempDir, relPath);
    await fs.mkdir(path.dirname(tempFilePath), { recursive: true });
    await fs.writeFile(tempFilePath, content, "utf-8");
  }

  getFile(uri: string): string | undefined {
    return this.cache.get(uri);
  }

  async removeFile(uri: string): Promise<void> {
    this.cache.delete(uri);
    const relPath = this.getGitIsomorphicPath(uri);
    const tempFilePath = path.join(this.tempDir, relPath);
    try {
      await fs.unlink(tempFilePath);
    } catch (e) {
      // Ignore if doesn't exist
    }
  }

  async writeAst(nodes: string[], edges: string[]): Promise<void> {
    const graphDir = path.join(this.tempDir, "graph");
    await fs.mkdir(graphDir, { recursive: true });

    if (nodes.length > 0) {
      const nodesFile = path.join(graphDir, "nodes.jsonl");
      await fs.appendFile(nodesFile, nodes.join("\n") + "\n", "utf-8");
    }
    if (edges.length > 0) {
      const edgesFile = path.join(graphDir, "edges.jsonl");
      await fs.appendFile(edgesFile, edges.join("\n") + "\n", "utf-8");
    }
  }
}
