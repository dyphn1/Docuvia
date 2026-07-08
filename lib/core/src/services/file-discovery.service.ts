import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import fg from "fast-glob";
import ignore from "ignore";
import { DiscoveredFile, IFileDiscovery } from "../interfaces/analyzer.interfaces.js";
import { IWorkspaceGitService } from "../interfaces/workspace-git.interfaces.js";
import { WorkspaceGitService } from "./workspace-git.service.js";
import { isSupportedSourceFile, getSupportedGlobExtensions } from "../utils/language-detection.js";

export class FileDiscoveryService implements IFileDiscovery {
  constructor(private workspaceGit: IWorkspaceGitService = new WorkspaceGitService()) {}

  public async discoverFiles(
    workspaceRoot: string,
    dbPath: string,
    options: { onlyIndexed?: boolean } = {}
  ): Promise<{
    filesToParse: DiscoveredFile[];
    existingHashes: Map<string, string>;
    skippedCount: number;
  }> {
    const { onlyIndexed = false } = options;
    let allFiles: string[] = [];
    const gitBlobHashes = new Map<string, string>();
    const dirtyFiles = new Set<string>();
    let usingGit = await this.workspaceGit.isGitRepository(workspaceRoot);

    if (usingGit) {
      console.log(`[docuvia] Starting global AST scan using Git-native blob hashing...`);
      try {
        const trackedHashes = await this.workspaceGit.listTrackedFilesWithBlobHash(workspaceRoot);
        for (const [file, blobSha] of trackedHashes) {
          gitBlobHashes.set(file, blobSha);
        }

        const untracked = await this.workspaceGit.listUntrackedFiles(workspaceRoot);
        const modified = await this.workspaceGit.listModifiedFiles(workspaceRoot);

        if (!onlyIndexed) {
          [...untracked, ...modified].forEach((f: string) => {
            if (f.trim()) dirtyFiles.add(f.trim());
          });

          allFiles = [...gitBlobHashes.keys(), ...untracked];
        } else {
          allFiles = [...gitBlobHashes.keys()];
        }
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
      } catch (e: any) {
        console.debug("[docuvia] No .gitignore found, proceeding without it.");
      }

      const globbedFiles = await fg(`**/*.{${getSupportedGlobExtensions().join(",")}}`, {
        cwd: workspaceRoot,
        ignore: ["node_modules/**", ".git/**", ".docuvia/**", "dist/**", "build/**"],
        absolute: false,
      });

      allFiles = ig.filter(globbedFiles);
      // Treat all globbed files as dirty so manual hashing is forced
      allFiles.forEach((f: string) => dirtyFiles.add(f));
    }

    // Filter by supported extensions (redundant for glob, but ensures git outputs are clean)
    allFiles = allFiles.filter(
      (f: string) =>
        isSupportedSourceFile(f) && !f.includes("node_modules/") && !f.includes(".docuvia/")
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
      } catch (e) {
        console.debug("[docuvia] project_files table might not exist, skipping hash check.");
      }
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

      if (onlyIndexed && usingGit && gitBlobHashes.has(file)) {
        currentHash = gitBlobHashes.get(file)!;
      }

      // If we don't have a hash (untracked/modified), or if the hash differs from DB, we MUST read the file
      if (!currentHash || existingHashes.get(file) !== currentHash) {
        try {
          if (onlyIndexed && usingGit && gitBlobHashes.has(file)) {
            const blobSha = gitBlobHashes.get(file)!;
            code = await this.workspaceGit.readBlobContent(workspaceRoot, blobSha);
          } else {
            code = await fs.readFile(path.join(workspaceRoot, file), "utf-8");
          }
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
