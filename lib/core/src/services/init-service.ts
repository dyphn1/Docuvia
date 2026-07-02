import fs from "fs/promises";
import path from "path";
import cp from "child_process";
import util from "util";

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

    return { success: true, message: "Project initialized successfully" };
  }
}
