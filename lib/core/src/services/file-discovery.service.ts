import { ENCODING_HEX, HASH_ALGO_SHA256 } from "../constants/encoding.js";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import fg from "fast-glob";
import ignore from "ignore";
import { DiscoveredFile, IFileDiscovery } from "../interfaces/analyzer.interfaces.js";
import { IWorkspaceGitService } from "../interfaces/workspace-git.interfaces.js";
import type { ProjectFilesRepo } from "../memory/repos/files-repo.js";
import {
  isSupportedSourceFile,
  getSupportedGlobExtensions,
  RUBY_EXTENSIONLESS_BASENAMES,
} from "../utils/language-detection.js";
import { MAX_FILE_SIZE_BYTES } from "../constants/paths.js";
import { logger } from "../utils/logger.js";

export class FileDiscoveryService implements IFileDiscovery {
  constructor(private workspaceGit: IWorkspaceGitService) {}

  public async discoverFiles(
    workspaceRoot: string,
    filesRepo: ProjectFilesRepo,
    options: { onlyIndexed?: boolean } = {}
  ): Promise<{
    filesToParse: DiscoveredFile[];
    existingHashes: Map<string, string>;
    skippedCount: number;
    skippedOversized: { file: string; sizeBytes: number }[];
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

      const globIgnore = ["node_modules/**", ".git/**", ".docuvia/**", "dist/**", "build/**"];

      const [extensionMatches, extensionlessBasenameMatches] = await Promise.all([
        fg(`**/*.{${getSupportedGlobExtensions().join(",")}}`, {
          cwd: workspaceRoot,
          ignore: globIgnore,
          absolute: false,
        }),
        // Ruby's extensionless conventional files (Rakefile, Gemfile, ...) can't match the
        // extension-only glob pattern above at all — they need a second, explicit pattern.
        fg(`**/{${Array.from(RUBY_EXTENSIONLESS_BASENAMES).join(",")}}`, {
          cwd: workspaceRoot,
          ignore: globIgnore,
          absolute: false,
        }),
      ]);
      const globbedFiles = [...extensionMatches, ...extensionlessBasenameMatches];

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

    // Read existing hashes via the injected `GraphStore.files` repo — replaces old Docuvia's
    // pattern of opening a brand-new `better-sqlite3` connection to `dbPath` just for this one
    // read (one of the "9 files each independently open their own connection" instances the
    // memory-layer rework eliminates). A fresh workspace has no rows yet, which `getAllHashes()`
    // already handles by returning an empty array.
    const existingHashes = new Map<string, string>();
    for (const { filePath, contentHash } of filesRepo.getAllHashes()) {
      if (contentHash !== null) existingHashes.set(filePath, contentHash);
    }

    // Determine which files actually need parsing
    const filesToParse: Array<{ file: string; hash: string; code: string }> = [];
    const skippedOversized: { file: string; sizeBytes: number }[] = [];
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
            currentHash = crypto.createHash(HASH_ALGO_SHA256).update(code).digest(ENCODING_HEX);
          }
        } catch (e) {
          continue; // File might have been deleted or inaccessible
        }

        // Check again after manual hashing
        if (existingHashes.get(file) !== currentHash) {
          const sizeBytes = Buffer.byteLength(code);
          if (sizeBytes > MAX_FILE_SIZE_BYTES) {
            logger.warn({ file, sizeBytes }, "Skipping oversized file");
            skippedOversized.push({ file, sizeBytes });
          } else {
            filesToParse.push({ file, hash: currentHash, code });
          }
        } else {
          skippedCount++;
        }
      } else {
        skippedCount++;
      }
    }

    console.log(
      `[docuvia] Git Hash Delta check: ${filesToParse.length} files need parsing. ${skippedCount} skipped. ${skippedOversized.length} skipped as oversized.`
    );

    return { filesToParse, existingHashes, skippedCount, skippedOversized };
  }
}
