import path from "path";
import fs from "fs/promises";
import * as fsSync from "fs";
import { AstWorkerPool, IASTWorkerPool } from "./ast-worker-pool.js";
import { openai } from "@workspace/integrations-openai-ai-server";
import Database from "better-sqlite3";
import crypto from "crypto";

let globalWorkerPool: AstWorkerPool | null = null;
let globalWorkerPoolInitialized = false;

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

  public async extractDecisions(filePath: string): Promise<{ decisions: string[] }> {
    console.log(`[docuvia] Extracting decisions from ${filePath}`);

    const absolutePath = path.resolve(this.workspaceRoot, filePath);

    if (!absolutePath.startsWith(this.workspaceRoot)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const astParsable = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".cpp", ".c"];
    const llmWhitelist = [".md", ".txt", ".json", ".yaml", ".yml"];

    if (llmWhitelist.includes(ext)) {
      try {
        const content = await fs.readFile(absolutePath, "utf-8");
        const response = await openai.chat.completions.create({
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
        const parsed = JSON.parse(response.choices[0].message.content || '{"decisions": []}');
        return { decisions: parsed.decisions || [] };
      } catch (e: any) {
        console.error(`[docuvia] LLM extraction failed for file ${filePath}:`, e.message);
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
      throw new Error(`Failed to read or parse file ${filePath}: ${e.message}`);
    }
  }
}
