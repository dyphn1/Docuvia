import fs from "fs/promises";
import path from "path";
import os from "os";
import pLimit from "p-limit";
import { logger } from "../utils/logger.js";
import { buildFastImportData, runGitFastImport } from "../utils/git-fast-import-helper.js";

// Bounded concurrency for the per-file reads in `collectFiles` below. Directory recursion
// (`fs.readdir`) is left unbounded — directories are typically far fewer than files and each
// `readdir` call completes quickly without holding a handle open. File reads are the FD-heavy
// leaf operation: an earlier, fully-unbounded version of this walk (every `fs.readFile` across
// the whole tree in flight at once, ~18k files in a timing test) crashed with `EMFILE: too many
// open files`. `limit()` is only applied to the leaf `fs.readFile` calls, never to the recursive
// `walk()` call itself — wrapping the recursive call in the same limiter would deadlock a
// bounded pool (a "walk" task holding a slot while awaiting child tasks that need a slot from
// the same, now-exhausted pool).
const COLLECT_FILES_READ_CONCURRENCY = os.cpus().length * 4;

export class LocalOrphanBranchWriter {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async packDirectoryToBranch(sourceDir: string, branchName: string): Promise<void> {
    logger.info({ sourceDir, branchName }, "Packing directory to branch");

    const files = await this.collectFiles(sourceDir);
    const now = Math.floor(Date.now() / 1000);
    const fastImportData = buildFastImportData(
      branchName,
      files,
      now,
      `chore: local snapshot of ${branchName}`
    );

    // Each snapshot fully replaces the branch tree (`deleteall` in buildFastImportData) as a
    // fresh root commit, so the ref update must be forced past any existing (unrelated) history.
    await runGitFastImport(this.workspaceRoot, fastImportData, true);

    logger.info({ branchName, fileCount: files.size }, "Packed directory to local orphan branch");
  }

  private async collectFiles(sourceDir: string): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const limit = pLimit(COLLECT_FILES_READ_CONCURRENCY);

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      // Parallelize both the per-file reads and the recursive subdirectory walks within this
      // directory, instead of a sequential `for...of` with `await` inside — this re-reads every
      // markdown file `writeMarkdown` just wrote, one at a time, which dominates `snapshot`'s
      // wall-clock time on repos with tens of thousands of small files. `files` is a single
      // shared Map mutated from concurrent promises, which is safe here: JS's single-threaded
      // event loop means `Map.set` calls never interleave mid-operation, and each entry writes
      // a distinct key (`relPath`), so there's no read-modify-write race either. Only the file
      // reads go through `limit()` (see `COLLECT_FILES_READ_CONCURRENCY` above) — directory
      // recursion stays unbounded.
      await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            const relPath = path.relative(sourceDir, fullPath);
            const content = await limit(() => fs.readFile(fullPath, "utf-8"));
            files.set(relPath, content);
          }
        })
      );
    };

    await walk(sourceDir);
    return files;
  }
}
