import Database from "better-sqlite3";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import cp from "child_process";
import util from "util";

const exec = util.promisify(cp.exec);

export class InitService {
  constructor(private workspaceRoot: string) {}

  public async init() {
    console.log(`[docuvia] Initializing project in ${this.workspaceRoot}`);

    const docuviaDir = path.join(this.workspaceRoot, ".docuvia");

    // 2. Setup branch
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

    // 3. Create directories
    try {
      await fs.mkdir(docuviaDir, { recursive: true });
      await fs.mkdir(path.join(docuviaDir, "l3_decisions"), { recursive: true });
    } catch {}

    // 4. Create SQLite database
    const dbPath = path.join(docuviaDir, "local.db");
    const isNewDb = !existsSync(dbPath);
    const db = new Database(dbPath);

    console.log(`[docuvia] Setting up local.db SQLite schema...`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS l1_tags (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL,
        description TEXT
      );
      CREATE TABLE IF NOT EXISTS l2_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        type TEXT,
        source_paths TEXT,
        l1_tag_id INTEGER,
        description TEXT
      );
      CREATE TABLE IF NOT EXISTS l2_node_l1_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        l2_node_id INTEGER NOT NULL,
        l1_tag_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS l3_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        l2_node_id INTEGER,
        title TEXT,
        content TEXT,
        status TEXT,
        created_at TEXT
      );
      
      CREATE TABLE IF NOT EXISTS project_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL DEFAULT 1,
        file_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        last_parsed_at TEXT,
        UNIQUE(project_id, file_path)
      );
      CREATE TABLE IF NOT EXISTS node_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_node_id INTEGER NOT NULL,
        target_node_id INTEGER NOT NULL,
        link_type TEXT
      );
    `);
    db.close();

    // 5. Install Git Hook
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

    return { success: true, message: "Project initialized successfully" };
  }
}
