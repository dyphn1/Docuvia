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
import {
  createNoopLogger,
  DOCUVIA_DIR_NAME,
  ENCODING_HEX,
  HASH_ALGO_SHA256,
  UTF8_ENCODING,
} from "@workspace/contracts";
import {
  isDiscoverableSourceFile,
  getSupportedGlobExtensions,
  RUBY_EXTENSIONLESS_BASENAMES,
} from "../utils/language-detection.js";
import { MAX_FILE_SIZE_BYTES } from "../constants/paths.js";
import {
  DISCOVERY_MESSAGES,
  COMMON_GLOB_IGNORE_PATTERNS,
} from "./discovery-constants.js";

const GITIGNORE_FILENAME = ".gitignore";

/** Per-file discovery state shared across the git/glob candidate scan and the hash-delta resolution loop. */
interface FileResolutionContext {
  workspaceRoot: string;
  onlyIndexed: boolean;
  usingGit: boolean;
  gitBlobHashes: Map<string, string>;
  dirtyFiles: Set<string>;
  existingHashes: Map<string, string>;
}

/** Outcome of resolving a single candidate file against known git blob hashes and previously stored content hashes. */
type FileOutcome =
  | { kind: "parse"; entry: DiscoveredFile }
  | { kind: "oversized"; file: string; sizeBytes: number }
  | { kind: "skip" }
  | { kind: "unreadable" };

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
    const gitBlobHashes = new Map<string, string>();
    const dirtyFiles = new Set<string>();

    const { allFiles, usingGit } = await this.resolveCandidateFiles(
      workspaceRoot,
      onlyIndexed,
      gitBlobHashes,
      dirtyFiles,
    );

    const existingHashes = this.buildExistingHashesMap(filesRepo);

    const fileCtx: FileResolutionContext = {
      workspaceRoot,
      onlyIndexed,
      usingGit,
      gitBlobHashes,
      dirtyFiles,
      existingHashes,
    };

    const { filesToParse, skippedOversized, skippedCount } =
      await this.categorizeFiles(allFiles, fileCtx);

    this.logger.debug(DISCOVERY_MESSAGES.GIT_HASH_DELTA_CHECK_COMPLETE, {
      filesToParse: filesToParse.length,
      skipped: skippedCount,
      skippedOversized: skippedOversized.length,
    });

    return { filesToParse, existingHashes, skippedCount, skippedOversized };
  }

  /** Determines the candidate file list: git-tracked/untracked scan when a git repo is present (falling back to a glob scan on failure), or a plain glob scan otherwise. Filters to supported source files either way. */
  private async resolveCandidateFiles(
    workspaceRoot: string,
    onlyIndexed: boolean,
    gitBlobHashes: Map<string, string>,
    dirtyFiles: Set<string>,
  ): Promise<{ allFiles: string[]; usingGit: boolean }> {
    let usingGit = await this.git.isGitRepository(workspaceRoot);
    let allFiles: string[] = [];

    if (usingGit) {
      this.logger.debug(DISCOVERY_MESSAGES.STARTING_GIT_BLOB_SCAN);
      const gitFiles = await this.scanGitTrackedFiles(
        workspaceRoot,
        onlyIndexed,
        gitBlobHashes,
        dirtyFiles,
      );
      if (gitFiles) {
        allFiles = gitFiles;
      } else {
        usingGit = false;
      }
    }

    if (!usingGit) {
      allFiles = await this.discoverViaGlobFallback(workspaceRoot, dirtyFiles);
    }

    // Single shared filter — the exact same rule `analyze` auto mode's delta ingestion applies
    // to its git-diff-derived file list (phase1-decision-integration.md §6b).
    allFiles = allFiles.filter((f: string) => isDiscoverableSourceFile(f));

    this.logger.debug(DISCOVERY_MESSAGES.DISCOVERED_SOURCE_FILES, {
      count: allFiles.length,
    });

    return { allFiles, usingGit };
  }

  /** Scans tracked/untracked/modified files via git, populating `gitBlobHashes`/`dirtyFiles`. Returns `null` (signalling a glob fallback) if any git operation throws. */
  private async scanGitTrackedFiles(
    workspaceRoot: string,
    onlyIndexed: boolean,
    gitBlobHashes: Map<string, string>,
    dirtyFiles: Set<string>,
  ): Promise<string[] | null> {
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

        return [...gitBlobHashes.keys(), ...untracked];
      }

      return [...gitBlobHashes.keys()];
    } catch (e) {
      this.logger.warn(DISCOVERY_MESSAGES.GIT_OPS_FAILED_FALLBACK, {
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  /** Glob-based candidate scan used when no git repository is available (or git ops failed): honors `.gitignore` and treats every match as dirty so its hash is always computed manually. */
  private async discoverViaGlobFallback(
    workspaceRoot: string,
    dirtyFiles: Set<string>,
  ): Promise<string[]> {
    this.logger.debug(DISCOVERY_MESSAGES.GIT_UNAVAILABLE_FALLBACK);
    const ig = ignore();
    try {
      const gitignoreContent = await fs.readFile(
        path.join(workspaceRoot, GITIGNORE_FILENAME),
        UTF8_ENCODING,
      );
      ig.add(gitignoreContent);
    } catch {
      this.logger.debug(DISCOVERY_MESSAGES.NO_GITIGNORE_FOUND);
    }

    const globIgnore = [
      ...COMMON_GLOB_IGNORE_PATTERNS,
      `${DOCUVIA_DIR_NAME}/**`,
    ];

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

    const allFiles = ig.filter(globbedFiles);
    // Treat all globbed files as dirty so manual hashing is forced
    allFiles.forEach((f: string) => dirtyFiles.add(f));
    return allFiles;
  }

  /** Reads existing hashes via the injected repo (narrowed to `FileHashLookup`) — a fresh workspace has no rows yet, which `getAllHashes()` already handles by returning an empty array. */
  private buildExistingHashesMap(
    filesRepo: FileHashLookup,
  ): Map<string, string> {
    const existingHashes = new Map<string, string>();
    for (const { filePath, contentHash } of filesRepo.getAllHashes()) {
      if (contentHash !== null) existingHashes.set(filePath, contentHash);
    }
    return existingHashes;
  }

  /** Resolves each candidate file's hash-delta outcome and buckets it into files-to-parse, oversized skips, or counted/uncounted skips. */
  private async categorizeFiles(
    allFiles: string[],
    ctx: FileResolutionContext,
  ): Promise<{
    filesToParse: DiscoveredFile[];
    skippedOversized: { file: string; sizeBytes: number }[];
    skippedCount: number;
  }> {
    const filesToParse: DiscoveredFile[] = [];
    const skippedOversized: { file: string; sizeBytes: number }[] = [];
    let skippedCount = 0;

    for (const file of allFiles) {
      const outcome = await this.resolveFileOutcome(file, ctx);
      switch (outcome.kind) {
        case "parse":
          filesToParse.push(outcome.entry);
          break;
        case "oversized":
          skippedOversized.push({
            file: outcome.file,
            sizeBytes: outcome.sizeBytes,
          });
          break;
        case "skip":
          skippedCount++;
          break;
        case "unreadable":
          // File might have been deleted or inaccessible — excluded from all counts.
          break;
      }
    }

    return { filesToParse, skippedOversized, skippedCount };
  }

  /** Determines what to do with a single candidate file: skip if its hash already matches the stored one (without or after a read), skip silently if it can't be read, flag as oversized, or queue it for parsing. */
  private async resolveFileOutcome(
    file: string,
    ctx: FileResolutionContext,
  ): Promise<FileOutcome> {
    const currentHash = this.resolveKnownBlobHash(file, ctx);

    // If we already have a hash and it matches the stored one, no read is needed.
    if (currentHash && ctx.existingHashes.get(file) === currentHash) {
      return { kind: "skip" };
    }

    const read = await this.readFileForHashing(file, currentHash, ctx);
    if (!read) {
      return { kind: "unreadable" };
    }

    // Check again after manual hashing
    if (ctx.existingHashes.get(file) === read.hash) {
      return { kind: "skip" };
    }

    const sizeBytes = Buffer.byteLength(read.code);
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      this.logger.warn(DISCOVERY_MESSAGES.SKIPPING_OVERSIZED_FILE, {
        file,
        sizeBytes,
      });
      return { kind: "oversized", file, sizeBytes };
    }

    return { kind: "parse", entry: { file, hash: read.hash, code: read.code } };
  }

  /** Looks up a file's already-known content hash from the git blob scan, if any (empty string when unknown and a read is required). */
  private resolveKnownBlobHash(
    file: string,
    ctx: FileResolutionContext,
  ): string {
    const isDirty = ctx.dirtyFiles.has(file);
    let currentHash = "";

    if (!isDirty && ctx.gitBlobHashes.has(file)) {
      currentHash = ctx.gitBlobHashes.get(file)!;
    }

    if (ctx.onlyIndexed && ctx.usingGit && ctx.gitBlobHashes.has(file)) {
      currentHash = ctx.gitBlobHashes.get(file)!;
    }

    return currentHash;
  }

  /** Reads a file's content (from the git blob store when indexing an already-known blob, from disk otherwise) and computes its hash manually if one wasn't already known. Returns `null` if the file is missing or inaccessible. */
  private async readFileForHashing(
    file: string,
    currentHash: string,
    ctx: FileResolutionContext,
  ): Promise<{ code: string; hash: string } | null> {
    try {
      let code: string;
      if (ctx.onlyIndexed && ctx.usingGit && ctx.gitBlobHashes.has(file)) {
        const blobSha = ctx.gitBlobHashes.get(file)!;
        code = await this.git.readBlobContent(ctx.workspaceRoot, blobSha);
      } else {
        code = await fs.readFile(
          path.join(ctx.workspaceRoot, file),
          UTF8_ENCODING,
        );
      }

      // Calculate hash manually for dirty/untracked files
      const hash =
        currentHash ||
        crypto.createHash(HASH_ALGO_SHA256).update(code).digest(ENCODING_HEX);

      return { code, hash };
    } catch {
      return null;
    }
  }
}
