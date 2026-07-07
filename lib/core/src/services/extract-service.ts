import path from "path";
import fs from "fs/promises";
import * as fsSync from "fs";
import { AstWorkerPool, IASTWorkerPool } from "./ast-worker-pool.js";
import { LLMOrchestrator, openaiTransport } from "@workspace/llm-orchestrator";
import Database from "better-sqlite3";
import crypto from "crypto";

let globalWorkerPool: AstWorkerPool | null = null;
let globalWorkerPoolInitialized = false;

/**
 * Terminate the module-level worker pool singleton (Issue 1.10) — call this from a host's
 * shutdown/deactivate hook (e.g. the VS Code extension's deactivate()) to avoid leaking worker
 * threads across repeated ExtractService usage in a long-lived process.
 */
export async function shutdownGlobalWorkerPool(): Promise<void> {
  if (globalWorkerPool) {
    await globalWorkerPool.terminate();
    globalWorkerPool = null;
    globalWorkerPoolInitialized = false;
  }
}

export class ExtractService {
  private workerPool: IASTWorkerPool;

  constructor(
    private workspaceRoot: string,
    workerPool?: IASTWorkerPool
  ) {
    if (workerPool) {
      this.workerPool = workerPool;
    } else {
      if (!globalWorkerPool) {
        globalWorkerPool = new AstWorkerPool();
      }
      this.workerPool = globalWorkerPool;
    }
  }

  private async ensureWorkerPool() {
    if (this.workerPool === globalWorkerPool && !globalWorkerPoolInitialized) {
      await globalWorkerPool!.initialize();
      globalWorkerPoolInitialized = true;
    }
  }

  public async extractDecisions(targetPath: string): Promise<{ decisions: string[] }> {
    console.log(`[docuvia] Extracting decisions from ${targetPath || "workspace root"}`);

    const absolutePath = targetPath
      ? path.resolve(this.workspaceRoot, targetPath)
      : this.workspaceRoot;

    if (!absolutePath.startsWith(this.workspaceRoot)) {
      throw new Error(`Path traversal detected: ${targetPath}`);
    }

    const stats = await fs.stat(absolutePath).catch(() => null);
    if (!stats) {
      throw new Error(`Path does not exist: ${targetPath}`);
    }

    if (stats.isDirectory()) {
      return this.extractFromDirectory(absolutePath);
    } else {
      return this.extractFromFile(absolutePath);
    }
  }

  private async extractFromDirectory(dirPath: string): Promise<{ decisions: string[] }> {
    const astParsable = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".cpp", ".c"];
    const llmWhitelist = [".md", ".txt", ".json", ".yaml", ".yml"];
    const allowedExts = new Set([...astParsable, ...llmWhitelist]);

    let allDecisions: string[] = [];

    async function walkDir(currentDir: string) {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const resPath = path.resolve(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walkDir(resPath);
        } else if (entry.isFile() && allowedExts.has(path.extname(entry.name).toLowerCase())) {
          try {
            // Use this.extractFromFile context carefully in closure, binding it to service
            const result = await (globalThis as any)._extractFromFileContext(resPath);
            allDecisions.push(...result.decisions);
          } catch (e: any) {
            console.warn(`[docuvia] Skipping ${resPath}: ${e.message}`);
          }
        }
      }
    }

    // Bind this to global variable so recursive function can access it without binding nightmare
    (globalThis as any)._extractFromFileContext = this.extractFromFile.bind(this);
    await walkDir(dirPath);
    delete (globalThis as any)._extractFromFileContext;

    // Deduplicate decisions
    return { decisions: Array.from(new Set(allDecisions)) };
  }

  private async extractFromFile(absolutePath: string): Promise<{ decisions: string[] }> {
    const ext = path.extname(absolutePath).toLowerCase();
    const astParsable = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".cpp", ".c"];
    const llmWhitelist = [".md", ".txt", ".json", ".yaml", ".yml"];

    if (llmWhitelist.includes(ext)) {
      try {
        const content = await fs.readFile(absolutePath, "utf-8");
        const orchestrator = new LLMOrchestrator({
          profile: {
            name: "openai",
            baseUrl: process.env.AI_OPENAI_BASE_URL || "https://api.openai.com/v1",
            defaultModel: process.env.AI_OPENAI_FAST_MODEL || "gpt-4o-mini",
          },
          transport: openaiTransport,
          apiKey: process.env.AI_OPENAI_API_KEY || "",
        });
        const response = await orchestrator.generate({
          model: process.env.AI_OPENAI_FAST_MODEL || "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'You are an architecture extraction agent. Your job is to extract high-level architectural decisions and patterns from this file. Output valid JSON in the format { "decisions": ["decision 1", "decision 2"] }.',
            },
            {
              role: "user",
              content: `Extract decisions from this file:\n\n${content.substring(0, 8000)}`,
            },
          ],
        });
        const parsed = JSON.parse(response.content || '{"decisions": []}');
        return { decisions: parsed.decisions || [] };
      } catch (e: any) {
        console.error(`[docuvia] LLM extraction failed for file ${absolutePath}:`, e.message);
        return { error: true, message: e.message, decisions: [] } as any;
      }
    }

    if (!astParsable.includes(ext)) {
      throw new Error("Unsupported file type");
    }

    try {
      const content = await fs.readFile(absolutePath, "utf-8");

      const extMap: Record<string, any> = {
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "typescript",
        ".jsx": "typescript",
        ".py": "python",
        ".rs": "rust",
        ".go": "go",
        ".java": "java",
        ".cpp": "cpp",
        ".c": "cpp",
      };

      const language = extMap[ext] || "typescript";

      await this.ensureWorkerPool();

      const response = await this.workerPool.parse({
        filePath: absolutePath,
        code: content,
        language,
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || "Unknown worker error");
      }

      const decisions = response.data.decisions || [];

      // Add fallback structural decisions
      if (content.includes("Hexagonal Architecture") || content.includes("hexagonal")) {
        decisions.push("Uses Hexagonal Architecture pattern");
      }
      if (content.includes("Drizzle") || content.includes("drizzle")) {
        decisions.push("Uses Drizzle ORM for database access");
      }

      if (decisions.length === 0) {
        decisions.push("No explicit structural decisions extracted.");
      }

      return { decisions };
    } catch (e: any) {
      throw new Error(`Failed to read or parse file ${absolutePath}: ${e.message}`);
    }
  }
}
