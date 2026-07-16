import { ENCODING_HEX, HASH_ALGO_SHA256 } from "../constants/encoding.js";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import fg from "fast-glob";
import ignore from "ignore";
import type {
  DiscoveredFile,
  DiscoveryResult,
  FileHashLookup,
  IFileDiscovery,
  IGitProvider,
  ILogger,
} from "@workspace/contracts";
import { createNoopLogger } from "@workspace/contracts";
import {
  isDiscoverableSourceFile,
  getSupportedGlobExtensions,
  RUBY_EXTENSIONLESS_BASENAMES,
} from "../utils/language-detection.js";
import { MAX_FILE_SIZE_BYTES } from "../constants/paths.js";

export class FileDiscoveryService implements IFileDiscovery {
  constructor(
    private readonly git: IGitProvider,
    private readonly logger: ILogger = createNoopLogger(),
  ) {}

  public async discoverFiles(
    workspaceRoot: string,
    filesRepo: FileHashLookup,
    options: { onlyIndexed?: boolean } = {},
  ): Promise<DiscoveryResult> {
    const { onlyIndexed = false } = options;
    let allFiles: string[] = [];
    const gitBlobHashes = new Map<string, string>();
    const dirtyFiles = new Set<string>();
    let usingGit = await this.git.isGitRepository(workspaceRoot);

    if (usingGit) {
      this.logger.debug(
        "Starting global AST scan using Git-native blob hashing",
      );
      try {
        const trackedHashes =
          await this.git.listTrackedFilesWithBlobHash(workspaceRoot);
        for (const [file, blobSha] of trackedHashes) {
          gitBlobHashes.set(file, blobSha);
        }

        const untracked = await this.git.listUntrackedFiles(workspaceRoot);
        const modified = await this.git.listModifiedFiles(workspaceRoot);

        if (!onlyIndexed) {
          [...untracked, ...modified].forEach((f: string) => {
            if (f.trim()) dirtyFiles.add(f.trim());
          });

          allFiles = [...gitBlobHashes.keys(), ...untracked];
        } else {
          allFiles = [...gitBlobHashes.keys()];
        }
      } catch (e) {
        this.logger.warn(
          "Git operations failed during discovery, falling back to manual globbing",
          {
            error: e instanceof Error ? e.message : String(e),
          },
        );
        usingGit = false;
      }
    }

    if (!usingGit) {
      this.logger.debug(
        "Git unavailable or no .git repository found; falling back to fast-glob + manual sha256 hashing",
      );
      const ig = ignore();
      try {
        const gitignoreContent = await fs.readFile(
          path.join(workspaceRoot, ".gitignore"),
          "utf-8",
        );
        ig.add(gitignoreContent);
      } catch {
        this.logger.debug("No .gitignore found, proceeding without it");
      }

      const globIgnore = [
        "node_modules/**",
        ".git/**",
        ".docuvia/**",
        "dist/**",
        "build/**",
      ];

      const [extensionMatches, extensionlessBasenameMatches] =
        await Promise.all([
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
      const globbedFiles = [
        ...extensionMatches,
        ...extensionlessBasenameMatches,
      ];

      allFiles = ig.filter(globbedFiles);
      // Treat all globbed files as dirty so manual hashing is forced
      allFiles.forEach((f: string) => dirtyFiles.add(f));
    }

    // Filter by supported extensions (redundant for glob, but ensures git outputs are clean)
    allFiles = allFiles.filter((f: string) => isDiscoverableSourceFile(f));

    this.logger.debug("Discovered source files", { count: allFiles.length });

    // Read existing hashes via the injected repo (narrowed to `FileHashLookup`) — a fresh
    // workspace has no rows yet, which `getAllHashes()` already handles by returning an empty
    // array.
    const existingHashes = new Map<string, string>();
    for (const { filePath, contentHash } of filesRepo.getAllHashes()) {
      if (contentHash !== null) existingHashes.set(filePath, contentHash);
    }

    // Determine which files actually need parsing
    const filesToParse: DiscoveredFile[] = [];
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
            code = await this.git.readBlobContent(workspaceRoot, blobSha);
          } else {
            code = await fs.readFile(path.join(workspaceRoot, file), "utf-8");
          }
          if (!currentHash) {
            // Calculate hash manually for dirty/untracked files
            currentHash = crypto
              .createHash(HASH_ALGO_SHA256)
              .update(code)
              .digest(ENCODING_HEX);
          }
        } catch {
          continue; // File might have been deleted or inaccessible
        }

        // Check again after manual hashing
        if (existingHashes.get(file) !== currentHash) {
          const sizeBytes = Buffer.byteLength(code);
          if (sizeBytes > MAX_FILE_SIZE_BYTES) {
            this.logger.warn("Skipping oversized file", { file, sizeBytes });
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

    this.logger.debug("Git hash delta check complete", {
      filesToParse: filesToParse.length,
      skipped: skippedCount,
      skippedOversized: skippedOversized.length,
    });

    return { filesToParse, existingHashes, skippedCount, skippedOversized };
  }
}
