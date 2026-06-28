import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import crypto from "crypto";
import Database from "better-sqlite3";
import fg from "fast-glob";
import ignore from "ignore";
import { AstWorkerPool } from "./AstWorkerPool.js";

export class AnalyzeService {
  constructor(private workspaceRoot: string) {}

  public async analyzeProject(): Promise<{ projectType: string; suggestedTags: string[] }> {
    console.log(`[docuvia] Analyzing project in ${this.workspaceRoot}`);

    let projectType = "unknown";
    const suggestedTags = new Set<string>();

    try {
      const packageJsonPath = path.join(this.workspaceRoot, "package.json");
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const pkg = JSON.parse(content);

      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      if (deps.typescript) {
        projectType = "typescript";
        suggestedTags.add("typescript");
      } else if (deps.react || deps.express || deps.vue || deps.next) {
        projectType = "javascript";
      }

      const frameworkMapping: Record<string, string[]> = {
        react: ["react", "frontend"],
        "react-dom": ["react", "frontend"],
        express: ["express", "backend"],
        vue: ["vue", "frontend"],
        next: ["nextjs", "frontend", "ssr"],
        "drizzle-orm": ["drizzle", "database"],
        vite: ["vite", "build-tool"],
        tailwindcss: ["tailwindcss", "css"],
        jest: ["jest", "testing"],
        vitest: ["vitest", "testing"],
        pg: ["postgres", "database"],
      };

      for (const [dep, tags] of Object.entries(frameworkMapping)) {
        if (deps[dep]) {
          tags.forEach((t) => suggestedTags.add(t));
        }
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.warn(`[docuvia] Warning: Failed to process package.json: ${e.message}`);
      }
    }

    try {
      const tsconfigPath = path.join(this.workspaceRoot, "tsconfig.json");
      await fs.access(tsconfigPath);
      const tsconfigContent = await fs.readFile(tsconfigPath, "utf-8");
      
      let isStrict = false;
      try {
        const parsed = JSON.parse(tsconfigContent);
        if (parsed?.compilerOptions?.strict === true) {
          isStrict = true;
        }
      } catch (parseError: any) {
        // Fallback to regex if JSON.parse fails due to comments
        if (/"strict"\s*:\s*true/.test(tsconfigContent)) {
          isStrict = true;
        } else {
          console.warn(`[docuvia] Warning: Failed to parse tsconfig.json: ${parseError.message}`);
        }
      }

      if (isStrict) {
        suggestedTags.add("strict-ts");
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        console.warn(`[docuvia] Warning: Failed to process tsconfig.json: ${e.message}`);
      }
    }

    const checkFileExists = async (filename: string) => {
      try {
        await fs.stat(path.join(this.workspaceRoot, filename));
        return true;
      } catch (e: any) {
        if (e.code !== "ENOENT") {
          console.warn(`[docuvia] Warning: Failed to stat ${filename}: ${e.message}`);
        }
        return false;
      }
    };

    if (await checkFileExists("vite.config.ts") || await checkFileExists("vite.config.js")) {
      suggestedTags.add("vite");
    }

    if (await checkFileExists("drizzle.config.ts") || await checkFileExists("drizzle.config.cjs") || await checkFileExists("drizzle.config.js")) {
      suggestedTags.add("drizzle");
    }

    if (projectType === "unknown") {
      projectType = "generic";
    }

    if (suggestedTags.size === 0) {
      suggestedTags.add("general");
    }

    // --- AST Scanning logic ---
    try {
      console.log(`[docuvia] Starting global AST scan...`);
      
      const ig = ignore();
      try {
        const gitignoreContent = await fs.readFile(path.join(this.workspaceRoot, ".gitignore"), "utf-8");
        ig.add(gitignoreContent);
      } catch (e: any) {}

      const files = await fg("**/*.{ts,js,jsx,tsx,py,go,rs,cpp,java,php,rb}", {
        cwd: this.workspaceRoot,
        ignore: ["node_modules/**", ".git/**", ".docuvia/**"],
        absolute: false,
      });

      const filteredFiles = ig.filter(files);
      console.log(`[docuvia] Discovered ${filteredFiles.length} files for AST parsing.`);

      const workerCount = Math.max(1, (os.cpus().length || 4) - 1);
      const pool = new AstWorkerPool();
      await pool.initialize(workerCount);

      const getLanguage = (file: string) => {
        const ext = path.extname(file).toLowerCase();
        switch (ext) {
          case ".ts":
          case ".tsx":
          case ".js":
          case ".jsx":
            return "typescript";
          case ".py": return "python";
          case ".rs": return "rust";
          case ".go": return "go";
          case ".cpp":
          case ".cc":
          case ".c":
          case ".h":
          case ".hpp": return "cpp";
          case ".java": return "java";
          case ".rb": return "ruby";
          case ".php": return "php";
          default: return "typescript";
        }
      };

      const parsedResults: Array<{ file: string, data: any }> = [];
      const batchSize = 100;
      for (let i = 0; i < filteredFiles.length; i += batchSize) {
        const batch = filteredFiles.slice(i, i + batchSize);
        const promises = batch.map(async (file) => {
          const absPath = path.join(this.workspaceRoot, file);
          try {
            const code = await fs.readFile(absPath, "utf-8");
            const res = await pool.parse({ filePath: file, code, language: getLanguage(file) });
            if (res.success && res.data) {
              parsedResults.push({ file, data: res.data });
            }
          } catch (e) {
            console.warn(`[docuvia] Failed to parse ${file}:`, e);
          }
        });
        await Promise.all(promises);
      }

      await pool.terminate();

      const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
      if (existsSync(dbPath)) {
        const db = new Database(dbPath);
        const insertNode = db.prepare(`INSERT INTO l2_nodes (id, name, slug, type, source_paths, description) VALUES (?, ?, ?, ?, ?, ?)`);
        const insertLink = db.prepare(`INSERT INTO node_links (source_node_id, target_node_id, link_type) VALUES (?, ?, ?)`);

        const runTransaction = db.transaction(() => {
          for (const result of parsedResults) {
            const fileId = crypto.randomUUID();
            insertNode.run(fileId, result.file, result.file, "file", JSON.stringify([result.file]), "");

            if (result.data.functions) {
              for (const fn of result.data.functions) {
                const fnId = crypto.randomUUID();
                insertNode.run(fnId, fn.name, fn.name, "function", JSON.stringify([result.file]), "");
                insertLink.run(fileId, fnId, "contains");
              }
            }
            
            if (result.data.classes) {
              for (const cls of result.data.classes) {
                const clsId = crypto.randomUUID();
                insertNode.run(clsId, cls.name, cls.name, "class", JSON.stringify([result.file]), "");
                insertLink.run(fileId, clsId, "contains");
              }
            }
            
            if (result.data.imports) {
              for (const imp of result.data.imports) {
                const impId = crypto.randomUUID();
                insertNode.run(impId, imp.name, imp.name, "import", JSON.stringify([result.file]), `Source: ${imp.source}`);
                insertLink.run(fileId, impId, "imports");
              }
            }
          }
        });

        runTransaction();
        db.close();
        console.log(`[docuvia] Inserted AST data for ${parsedResults.length} files into local.db.`);
      }
    } catch (e: any) {
      console.error(`[docuvia] AST scan failed:`, e.message);
    }

    return { projectType, suggestedTags: Array.from(suggestedTags) };
  }
}
