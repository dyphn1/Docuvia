import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import crypto from "crypto";
import Database from "better-sqlite3";
import fg from "fast-glob";
import ignore from "ignore";
import { AstWorkerPool } from "./AstWorkerPool.js";
import { ScopeResolver } from "./ScopeResolver.js";
import { exec } from "child_process";
import * as util from "util";

export class AnalyzeService {
  constructor(private workspaceRoot: string) {}

  public async analyzeProject(options?: { deep?: boolean }): Promise<{ projectType: string; suggestedTags: string[] }> {
    console.log(`[docuvia] Analyzing project in ${this.workspaceRoot}`);

    let projectType = "unknown";
    const suggestedTags = new Set<string>();

    try {
      const configFiles = await fg([
        "**/package.json",
        "**/Cargo.toml",
        "**/pyproject.toml",
        "**/requirements.txt",
        "**/go.mod",
        "**/tsconfig.json",
        "**/vite.config.*",
        "**/drizzle.config.*",
        "**/webpack.config.*",
        "**/tauri.conf.*"
      ], {
        cwd: this.workspaceRoot,
        ignore: ["node_modules/**", ".git/**", "dist/**", "build/**", "target/**", "venv/**", ".venv/**", "**/fixtures/**", "**/__fixtures__/**", "**/test-data/**"],
        absolute: true,
        deep: 3,
      });

      for (const file of configFiles) {
        const basename = path.basename(file);
        try {
          const content = await fs.readFile(file, "utf-8");
          
          if (basename === "package.json") {
            if (content.includes('"typescript"')) suggestedTags.add("typescript");
            if (content.includes('"react"')) { suggestedTags.add("react"); suggestedTags.add("frontend"); }
            if (content.includes('"vue"')) { suggestedTags.add("vue"); suggestedTags.add("frontend"); }
            if (content.includes('"next"')) { suggestedTags.add("nextjs"); suggestedTags.add("frontend"); suggestedTags.add("ssr"); }
            if (content.includes('"express"')) { suggestedTags.add("express"); suggestedTags.add("backend"); }
            if (content.includes('"drizzle-orm"')) { suggestedTags.add("drizzle"); suggestedTags.add("database"); }
            if (content.includes('"tailwindcss"')) { suggestedTags.add("tailwindcss"); suggestedTags.add("css"); }
            if (content.includes('"jest"')) { suggestedTags.add("jest"); suggestedTags.add("testing"); }
            if (content.includes('"vitest"')) { suggestedTags.add("vitest"); suggestedTags.add("testing"); }
            if (content.includes('"pg"')) { suggestedTags.add("postgres"); suggestedTags.add("database"); }
            if (content.includes('"workspaces"')) suggestedTags.add("monorepo");
          } else if (basename === "Cargo.toml") {
            projectType = "rust";
            suggestedTags.add("rust");
            if (content.includes('tokio')) { suggestedTags.add("tokio"); suggestedTags.add("async"); }
            if (content.includes('actix')) { suggestedTags.add("actix"); suggestedTags.add("backend"); }
            if (content.includes('serde')) suggestedTags.add("serde");
            if (content.includes('tauri')) { suggestedTags.add("tauri"); suggestedTags.add("desktop"); }
          } else if (basename === "pyproject.toml" || basename === "requirements.txt") {
            projectType = "python";
            suggestedTags.add("python");
            if (content.includes('django')) { suggestedTags.add("django"); suggestedTags.add("backend"); }
            if (content.includes('fastapi')) { suggestedTags.add("fastapi"); suggestedTags.add("backend"); }
            if (content.includes('pandas')) { suggestedTags.add("pandas"); suggestedTags.add("data"); }
          } else if (basename === "go.mod") {
            projectType = "go";
            suggestedTags.add("go");
            if (content.includes('gin-gonic')) { suggestedTags.add("gin"); suggestedTags.add("backend"); }
          } else if (basename === "tsconfig.json") {
            if (/"strict"\s*:\s*true/.test(content)) suggestedTags.add("strict-ts");
          } else if (basename.startsWith("vite.config")) {
            suggestedTags.add("vite");
            suggestedTags.add("build-tool");
          } else if (basename.startsWith("drizzle.config")) {
            suggestedTags.add("drizzle");
            suggestedTags.add("database");
          } else if (basename.startsWith("tauri.conf")) {
            suggestedTags.add("tauri");
            suggestedTags.add("desktop");
          }
        } catch (e) {
          // ignore read errors for individual files
        }
      }

      if (suggestedTags.has("typescript") || suggestedTags.has("react") || suggestedTags.has("express") || suggestedTags.has("vue")) {
        if (projectType === "unknown") projectType = "javascript";
      }

    } catch (e: any) {
      console.warn(`[docuvia] Warning: Failed multi-dimensional config scanning: ${e.message}`);
    }

    if (projectType === "unknown") {
      projectType = "generic";
    }

    if (suggestedTags.size === 0) {
      suggestedTags.add("general");
    }

    // --- AST Scanning logic ---
    try {
      
      const execAsync = util.promisify(exec);
      
      let allFiles: string[] = [];
      const gitBlobHashes = new Map<string, string>();
      const dirtyFiles = new Set<string>();
      let usingGit = false;

      try {
        // Test if git is available and we are in a git repository
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: this.workspaceRoot });
        usingGit = true;
      } catch (e) {
        usingGit = false;
      }

      if (usingGit) {
        console.log(`[docuvia] Starting global AST scan using Git-native blob hashing...`);
        try {
          const res = await execAsync('git ls-files -s', { cwd: this.workspaceRoot });
          for (const line of res.stdout.split('\n')) {
            if (!line.trim()) continue;
            const [info, file] = line.split('\t');
            const blobSha = info.split(' ')[1];
            if (file && blobSha) gitBlobHashes.set(file, blobSha);
          }
          
          const untracked = await execAsync('git ls-files --others --exclude-standard', { cwd: this.workspaceRoot });
          const modified = await execAsync('git diff --name-only', { cwd: this.workspaceRoot });
          
          [...untracked.stdout.split('\n'), ...modified.stdout.split('\n')].forEach((f: string) => {
            if (f.trim()) dirtyFiles.add(f.trim());
          });

          allFiles = [...gitBlobHashes.keys(), ...untracked.stdout.split('\n').map((f: string) => f.trim()).filter(Boolean)];
        } catch (e) {
          console.warn("[docuvia] Git operations failed during execution, falling back to manual globbing...");
          usingGit = false;
        }
      }

      if (!usingGit) {
        console.log(`[docuvia] Git unavailable or no .git repository found. Falling back to fast-glob + manual sha256 hashing...`);
        const ig = ignore();
        try {
          const gitignoreContent = await fs.readFile(path.join(this.workspaceRoot, ".gitignore"), "utf-8");
          ig.add(gitignoreContent);
        } catch (e: any) {}

        const globbedFiles = await fg("**/*.{ts,js,jsx,tsx,py,go,rs,cpp,c,h,hpp,java,php,rb}", {
          cwd: this.workspaceRoot,
          ignore: ["node_modules/**", ".git/**", ".docuvia/**", "dist/**", "build/**"],
          absolute: false,
        });
        
        allFiles = ig.filter(globbedFiles);
        // Treat all globbed files as dirty so manual hashing is forced
        allFiles.forEach((f: string) => dirtyFiles.add(f)); 
      }

      // Filter by supported extensions (redundant for glob, but ensures git outputs are clean)
      const extRegex = /\.(ts|js|jsx|tsx|py|go|rs|cpp|c|h|hpp|java|php|rb)$/;
      allFiles = allFiles.filter((f: string) => extRegex.test(f) && !f.includes('node_modules/') && !f.includes('.docuvia/'));

      console.log(`[docuvia] Discovered ${allFiles.length} source files.`);

      // 5. Connect to DB and fetch existing hashes
      const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
      let db;
      let existingHashes = new Map<string, string>();
      if (existsSync(dbPath)) {
        db = new Database(dbPath);
        try {
          const rows = db.prepare('SELECT file_path, content_hash FROM project_files').all() as any[];
          for (const row of rows) {
            existingHashes.set(row.file_path, row.content_hash);
          }
        } catch (e) {} // Table might not exist if init failed partially
      }

      // 6. Determine which files actually need parsing
      const filesToParse: Array<{ file: string, hash: string, code: string }> = [];
      let skippedCount = 0;

      for (const file of allFiles) {
        let currentHash = "";
        let code = "";
        const isDirty = dirtyFiles.has(file);

        if (!isDirty && gitBlobHashes.has(file)) {
          currentHash = gitBlobHashes.get(file)!;
        }

        // If we don't have a hash (untracked/modified), or if the hash differs from DB, we MUST read the file
        if (!currentHash || existingHashes.get(file) !== currentHash) {
          try {
            code = await fs.readFile(path.join(this.workspaceRoot, file), "utf-8");
            if (!currentHash) {
              // Calculate hash manually for dirty/untracked files
              currentHash = crypto.createHash('sha256').update(code).digest('hex');
            }
          } catch (e) {
            continue; // File might have been deleted or inaccessible
          }

          // Check again after manual hashing
          if (existingHashes.get(file) !== currentHash) {
            filesToParse.push({ file, hash: currentHash, code });
          } else {
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
      }

      console.log(`[docuvia] Git Hash Delta check: ${filesToParse.length} files need parsing. ${skippedCount} skipped.`);

      let globalFileIdMap = new Map<string, string>();

      if (filesToParse.length > 0 && db) {
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

        const parsedResults: Array<{ file: string, hash: string, data: any }> = [];
        const batchSize = 50;
        for (let i = 0; i < filesToParse.length; i += batchSize) {
          const batch = filesToParse.slice(i, i + batchSize);
          const promises = batch.map(async (item) => {
            try {
              const res = await pool.parse({ filePath: item.file, code: item.code, language: getLanguage(item.file) });
              if (res.success && res.data) {
                parsedResults.push({ file: item.file, hash: item.hash, data: res.data });
              } else {
                console.log(`[docuvia] parse returned false for ${item.file}: ${res.error}`);
              }
            } catch (e) {
              console.warn(`[docuvia] Failed to parse ${item.file}:`, e);
            }
          });
          await Promise.all(promises);
        }

        await pool.terminate();

        const resolver = new ScopeResolver(this.workspaceRoot);
        for (const result of parsedResults) {
          const locals: string[] = [];
          if (result.data.functions) locals.push(...result.data.functions.map((f: any) => f.name));
          if (result.data.classes) locals.push(...result.data.classes.map((c: any) => c.name));
          resolver.registerFile(result.file, result.data.imports || [], [], locals);
        }

        // Transaction for bulk inserting the new AST nodes
        const insertHash = db.prepare('INSERT INTO project_files (project_id, file_path, content_hash) VALUES (1, ?, ?) ON CONFLICT (project_id, file_path) DO UPDATE SET content_hash = excluded.content_hash, last_parsed_at = CURRENT_TIMESTAMP');
        const deleteOldL1Links = db.prepare('DELETE FROM l2_node_l1_tags WHERE l2_node_id IN (SELECT id FROM l2_nodes WHERE source_paths = ?)');
        const deleteOldLinks = db.prepare('DELETE FROM node_links WHERE source_node_id IN (SELECT id FROM l2_nodes WHERE source_paths = ?)');
        const deleteOldNodes = db.prepare('DELETE FROM l2_nodes WHERE source_paths = ?');
        const insertNode = db.prepare('INSERT INTO l2_nodes (id, name, slug, type, source_paths, description) VALUES (?, ?, ?, ?, ?, ?)');
        const insertLink = db.prepare('INSERT INTO node_links (source_node_id, target_node_id, link_type) VALUES (?, ?, ?)');
        const insertL1Tag = db.prepare('INSERT INTO l1_tags (id, name, slug, description) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');
        const insertL2L1Link = db.prepare('INSERT INTO l2_node_l1_tags (l2_node_id, l1_tag_id) VALUES (?, ?)');

        const runTransaction = db.transaction(() => {
          let parsedCount = 0;
          const fileIdMap = new Map<string, string>();
          
          // Ensure all tags exist
          for (const tag of suggestedTags) {
            insertL1Tag.run(tag, tag, tag, `Auto-detected tag: ${tag}`);
          }

          for (const result of parsedResults) {
            const sourcePathJson = JSON.stringify([result.file]);
            
            // Clean up old nodes for this file
            deleteOldL1Links.run(sourcePathJson);
            deleteOldLinks.run(sourcePathJson);
            deleteOldNodes.run(sourcePathJson);

            // Insert new nodes
            const fileId = crypto.randomUUID();
            fileIdMap.set(result.file, fileId);
            insertNode.run(fileId, result.file, result.file, "file", sourcePathJson, "");

            // Link L2 file node to L1 tags
            for (const tag of suggestedTags) {
              insertL2L1Link.run(fileId, tag);
            }

            if (result.data.functions) {
              for (const fn of result.data.functions) {
                const fnId = crypto.randomUUID();
                insertNode.run(fnId, fn.name, fn.name, "function", sourcePathJson, "");
                insertLink.run(fileId, fnId, "contains");
              }
            }
            
            if (result.data.classes) {
              for (const cls of result.data.classes) {
                const clsId = crypto.randomUUID();
                insertNode.run(clsId, cls.name, cls.name, "class", sourcePathJson, "");
                insertLink.run(fileId, clsId, "contains");
              }
            }
          }

          // Pass 2: Resolve edges using the ScopeResolver and create them
          for (const result of parsedResults) {
            const sourceFileId = fileIdMap.get(result.file);
            if (!sourceFileId) continue;

            if (result.data.calls) {
              for (const call of result.data.calls) {
                const resolved = resolver.resolveCall(result.file, call.targetFunction);
                if (resolved) {
                  // Link file to file directly, avoiding ambiguous function names across the db
                  const targetPathJson = JSON.stringify([resolved.targetFile]);
                  let targetFileId = fileIdMap.get(resolved.targetFile);
                  
                  if (!targetFileId) {
                    const row = db.prepare("SELECT id FROM l2_nodes WHERE type = 'file' AND source_paths = ?").get(targetPathJson) as { id: string } | undefined;
                    if (row) targetFileId = row.id;
                  }

                  if (targetFileId && targetFileId !== sourceFileId) { // avoid self-calls clutter
                    insertLink.run(sourceFileId, targetFileId, "calls");
                  }
                }
              }
            }
            
            // Update hash
            insertHash.run(result.file, result.hash);
            parsedCount++;
          }
          return { parsedCount, fileIdMap };
        });

        const { parsedCount: updatedCount, fileIdMap } = runTransaction();
        globalFileIdMap = fileIdMap;
        console.log(`[docuvia] AST scan complete: ${updatedCount} updated, ${skippedCount} skipped (unchanged).`);
      } else {
        console.log(`[docuvia] AST scan complete: 0 updated, ${skippedCount} skipped (unchanged).`);
      }

      if (db) db.close();

      if (options?.deep) {
        console.log(`[docuvia] Triggering background L3 Agentic RAG extraction...`);
        const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
        setTimeout(async () => {
          let backgroundDb;
          try {
            if (existsSync(dbPath)) {
              backgroundDb = new Database(dbPath);
            }
            if (!backgroundDb) return;

            const { ExtractService } = await import("./ExtractService.js");
            const extractService = new ExtractService(this.workspaceRoot);
            
            // Initialize l3_nodes schema if not exists just in case
            backgroundDb.exec(`
              CREATE TABLE IF NOT EXISTS l3_nodes (
                id TEXT PRIMARY KEY,
                l2_node_id TEXT,
                title TEXT,
                content TEXT,
                status TEXT,
                created_at TEXT
              );
            `);

            const insertL3Node = backgroundDb.prepare('INSERT INTO l3_nodes (id, l2_node_id, title, content, status, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');

            for (const item of filesToParse) {
              const l2NodeId = globalFileIdMap.get(item.file);
              if (!l2NodeId) continue;

              try {
                const result = await extractService.extractDecisions(item.file);
                if ((result as any).error) {
                  continue; // Skip failed extractions
                }
                
                // Clear old l3 nodes for this l2_node before inserting new ones
                backgroundDb.prepare('DELETE FROM l3_nodes WHERE l2_node_id = ?').run(l2NodeId);

                if (result.decisions) {
                  for (const decision of result.decisions) {
                    const l3Id = crypto.randomUUID();
                    insertL3Node.run(l3Id, l2NodeId, decision, "", "active");
                  }
                }
              } catch (e: any) {
                console.error(`[docuvia] L3 Extraction Error for file ${item.file}:`, e.message);
              }
            }

            console.log(`[docuvia] Background L3 extraction finished.`);
          } catch (e: any) {
            console.error('[docuvia] L3 Extraction background task failed', e);
          } finally {
            if (backgroundDb) backgroundDb.close();
          }
        }, 1000);
      }
    } catch (e: any) {
      console.error(`[docuvia] AST scan failed:`, e.message);
    }

    return { projectType, suggestedTags: Array.from(suggestedTags) };
  }
}
