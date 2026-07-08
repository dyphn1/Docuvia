import fs from "fs/promises";
import path from "path";
import cp from "child_process";
import util from "util";
import Database from "better-sqlite3";
import { ensureLocalFtsIndex } from "./sqlite-fts.js";
import { TempFileManager } from "./temp-file-manager.js";
import { logger } from "../utils/logger.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const exec = util.promisify(cp.exec);

export class InitService {
  constructor(
    private workspaceRoot: string,
    private logCallback: (msg: string) => void = (msg) => console.log(msg)
  ) {}

  public async init() {
    this.logCallback(`Initializing project in ${this.workspaceRoot}...`);

    // 1. Setup branch
    let branchExists = false;
    try {
      const { stdout } = await exec("git branch --list docuvia-knowledge", {
        cwd: this.workspaceRoot,
      });
      if (stdout.trim().length > 0) {
        branchExists = true;
      }
    } catch {}

    if (!branchExists) {
      try {
        this.logCallback(`Creating hidden docuvia-knowledge branch...`);
        const { stdout: treeHash } = await exec("git hash-object -t tree /dev/null", {
          cwd: this.workspaceRoot,
        });
        const { stdout: commitHash } = await exec(
          `echo "chore: initialize empty knowledge graph" | git commit-tree ${treeHash.trim()}`,
          { cwd: this.workspaceRoot }
        );
        await exec(`git update-ref refs/heads/docuvia-knowledge ${commitHash.trim()}`, {
          cwd: this.workspaceRoot,
        });
      } catch (err: any) {
        throw new Error(`Failed to create branch: ${err.message}`);
      }
    }

    // 2. Install Git Hook
    try {
      const gitHookDir = path.join(this.workspaceRoot, ".git", "hooks");
      const postCommitPath = path.join(gitHookDir, "post-commit");
      let hookDirExists = false;
      try {
        await fs.access(gitHookDir);
        hookDirExists = true;
      } catch {}

      if (hookDirExists) {
        const hookContent = `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n# Non-intrusively extracts AST deltas in the background\nif command -v npx &> /dev/null; then\n  # Fire and forget (do not block commit)\n  npx --no-install docuvia snapshot > /dev/null 2>&1 &\nfi\n`;

        let shouldWriteHook = true;
        try {
          const existingHook = await fs.readFile(postCommitPath, "utf8");
          if (existingHook.includes("docuvia snapshot")) {
            shouldWriteHook = false;
          }
        } catch (e) {
          // File does not exist, safe to write
        }

        if (shouldWriteHook) {
          this.logCallback(`Installing post-commit hook...`);
          await fs.appendFile(postCommitPath, hookContent);
          await fs.chmod(postCommitPath, 0o755);
        }
      }
    } catch (err) {
      // Fail silently for hook
    }

    // 3. Initialize SQLite database
    try {
      const docuviaDir = path.join(this.workspaceRoot, ".docuvia");
      await fs.mkdir(docuviaDir, { recursive: true });
      const dbPath = path.join(docuviaDir, "local.db");
      const db = new Database(dbPath);

      this.logCallback(`Initializing SQLite database...`);
      const schemaSql = await fs.readFile(
        path.join(__dirname, "..", "constants", "schema.sql"),
        "utf8"
      );
      db.exec(schemaSql);
      // FTS5 keyword indexes for the local-first natural language fallback (ADR-029)
      ensureLocalFtsIndex(db);
      db.close();
    } catch (err: any) {
      throw new Error(`Could not initialize database: ${err.message}`);
    }

    // 4. Initialize TempFileManager for LSP and incremental updates
    try {
      const tempFileManager = new TempFileManager(this.workspaceRoot);
      await tempFileManager.initialize();
      this.logCallback(`Initializing temp file manager...`);

      // Register cleanup hook on SIGTERM
      const cleanupHandler = async () => {
        logger.info("Cleaning up temp files on shutdown...");
        await tempFileManager.cleanup();
        tempFileManager.stopCleanup();
      };

      process.on("SIGTERM", cleanupHandler);
      process.on("SIGINT", cleanupHandler);

      logger.info({ tempDir: tempFileManager.getTempDirPath() }, "Temp file manager initialized");
    } catch (err: any) {
      logger.warn({ error: err.message }, "Failed to initialize temp file manager (non-fatal)");
    }

    return { success: true, message: "Project initialized successfully" };
  }
}
