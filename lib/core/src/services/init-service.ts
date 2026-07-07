import fs from "fs/promises";
import path from "path";
import cp from "child_process";
import util from "util";
import Database from "better-sqlite3";
import { ensureLocalFtsIndex } from "./sqlite-fts.js";

const exec = util.promisify(cp.exec);

export class InitService {
  constructor(private workspaceRoot: string) {}

  public async init() {
    console.log(`[docuvia] Initializing project in ${this.workspaceRoot}`);

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
        console.log(`[docuvia] Creating hidden docuvia-knowledge branch...`);
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
    } else {
      console.log(`[docuvia] Branch docuvia-knowledge already exists.`);
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
        const hookContent = `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n# Non-intrusively extracts AST deltas in the background\nif command -v npx &> /dev/null; then\n  # Fire and forget (do not block commit)\n  npx --no-install docuvia sync --local > /dev/null 2>&1 &\nfi\n`;

        let shouldWriteHook = true;
        try {
          const existingHook = await fs.readFile(postCommitPath, "utf8");
          if (existingHook.includes("docuvia sync")) {
            shouldWriteHook = false;
          }
        } catch (e) {
          // File does not exist, safe to write
        }

        if (shouldWriteHook) {
          console.log(`[docuvia] Installing post-commit hook...`);
          await fs.appendFile(postCommitPath, hookContent);
          await fs.chmod(postCommitPath, 0o755);
        }
      }
    } catch (err) {
      console.warn("[docuvia] Could not install git hook:", err);
    }

    // 3. Initialize SQLite database
    try {
      const docuviaDir = path.join(this.workspaceRoot, ".docuvia");
      await fs.mkdir(docuviaDir, { recursive: true });
      const dbPath = path.join(docuviaDir, "local.db");
      const db = new Database(dbPath);

      console.log(`[docuvia] Initializing SQLite database...`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER,
          file_path TEXT,
          content_hash TEXT,
          last_parsed_at TEXT DEFAULT CURRENT_TIMESTAMP,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(project_id, file_path)
        );
        CREATE TABLE IF NOT EXISTS l1_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE,
          slug TEXT,
          description TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS l2_nodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER,
          name TEXT,
          slug TEXT,
          type TEXT,
          is_system INTEGER DEFAULT 0,
          description TEXT,
          ai_generated INTEGER DEFAULT 1,
          needs_review INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          last_verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
          path_patterns TEXT,
          reindex_required INTEGER DEFAULT 0,
          is_bootstrap_confirmed INTEGER DEFAULT 0,
          content_hash TEXT,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS node_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_node_id INTEGER,
          target_node_id INTEGER,
          link_type TEXT,
          commit_sha TEXT,
          diff_summary TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS l2_node_l1_tags (
          l2_node_id INTEGER,
          l1_tag_id INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS l3_nodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          l2_node_id INTEGER,
          title TEXT,
          content TEXT,
          status TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
      // FTS5 keyword indexes for the local-first natural language fallback (ADR-029)
      ensureLocalFtsIndex(db);
      db.close();
    } catch (err: any) {
      console.warn(`[docuvia] Could not initialize database: ${err.message}`);
    }

    return { success: true, message: "Project initialized successfully" };
  }
}
