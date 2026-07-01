import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import fg from "fast-glob";
import ignore from "ignore";
import { exec } from "child_process";
import * as util from "util";
import { IFileDiscovery } from "../interfaces/analyzer.interfaces.js";

export class FileDiscoveryService implements IFileDiscovery {
  public async discoverFiles(
    workspaceRoot: string,
    dbPath: string
  ): Promise<{ filesToParse: any[]; existingHashes: Map<string, string>; skippedCount: number }> {
    const execAsync = util.promisify(exec);
    let allFiles: string[] = [];
    const gitBlobHashes = new Map<string, string>();
    const dirtyFiles = new Set<string>();
    let usingGit = false;

    try {
      // Test if git is available and we are in a git repository
      await execAsync("git rev-parse --is-inside-work-tree", { cwd: workspaceRoot });
      usingGit = true;
    } catch (e) {
      usingGit = false;
    }

    if (usingGit) {
      console.log(`[docuvia] Starting global AST scan using Git-native blob hashing...`);
      try {
        const res = await execAsync("git ls-files -s", { cwd: workspaceRoot });
        for (const line of res.stdout.split("\n")) {
          if (!line.trim()) continue;
          const [info, file] = line.split("\t");
          const blobSha = info.split(" ")[1];
          if (file && blobSha) gitBlobHashes.set(file, blobSha);
        }

        const untracked = await execAsync("git ls-files --others --exclude-standard", {
          cwd: workspaceRoot,
        });
        const modified = await execAsync("git diff --name-only", { cwd: workspaceRoot });

        [...untracked.stdout.split("\n"), ...modified.stdout.split("\n")].forEach((f: string) => {
          if (f.trim()) dirtyFiles.add(f.trim());
        });

        allFiles = [
          ...gitBlobHashes.keys(),
          ...untracked.stdout
            .split("\n")
            .map((f: string) => f.trim())
            .filter(Boolean),
        ];
      } catch (e) {
        console.warn(
          "[docuvia] Git operations failed during execution, falling back to manual globbing..."
        );
        usingGit = false;
      }
    }

    if (!usingGit) {
      console.log(
        `[docuvia] Git unavailable or no .git repository found. Falling back to fast-glob + manual sha256 hashing...`
      );
      const ig = ignore();
      try {
        const gitignoreContent = await fs.readFile(path.join(workspaceRoot, ".gitignore"), "utf-8");
        ig.add(gitignoreContent);
      } catch (e: any) {}

      const globbedFiles = await fg("**/*.{ts,js,jsx,tsx,py,go,rs,cpp,c,h,hpp,java,php,rb}", {
        cwd: workspaceRoot,
        ignore: ["node_modules/**", ".git/**", ".docuvia/**", "dist/**", "build/**"],
        absolute: false,
      });

      allFiles = ig.filter(globbedFiles);
      // Treat all globbed files as dirty so manual hashing is forced
      allFiles.forEach((f: string) => dirtyFiles.add(f));
    }

    // Filter by supported extensions (redundant for glob, but ensures git outputs are clean)
    const extRegex = /\.(ts|js|jsx|tsx|py|go|rs|cpp|c|h|hpp|java|php|rb)$/;
    allFiles = allFiles.filter(
      (f: string) => extRegex.test(f) && !f.includes("node_modules/") && !f.includes(".docuvia/")
    );

    console.log(`[docuvia] Discovered ${allFiles.length} source files.`);

    // Connect to DB and fetch existing hashes
    let db;
    let existingHashes = new Map<string, string>();
    if (existsSync(dbPath)) {
      db = new Database(dbPath);
      try {
        const rows = db.prepare("SELECT file_path, content_hash FROM project_files").all() as any[];
        for (const row of rows) {
          existingHashes.set(row.file_path, row.content_hash);
        }
      } catch (e) {} // Table might not exist if init failed partially
      if (db) db.close();
    }

    // Determine which files actually need parsing
    const filesToParse: Array<{ file: string; hash: string; code: string }> = [];
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
          code = await fs.readFile(path.join(workspaceRoot, file), "utf-8");
          if (!currentHash) {
            // Calculate hash manually for dirty/untracked files
            currentHash = crypto.createHash("sha256").update(code).digest("hex");
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

    console.log(
      `[docuvia] Git Hash Delta check: ${filesToParse.length} files need parsing. ${skippedCount} skipped.`
    );

    return { filesToParse, existingHashes, skippedCount };
  }
}
