import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createMockLogger } from "@workspace/contracts";
import {
  collectSourceFiles,
  MAX_ANALYZE_FILES,
  MAX_ANALYZE_BYTES,
} from "./decision-extraction.js";

describe("collectSourceFiles()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-decision-extraction-test-"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips node_modules/.git/.docuvia directories and only collects isSupportedSourceFile() matches", () => {
    fs.mkdirSync(path.join(tmpDir, "node_modules", "some-pkg"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, "node_modules", "some-pkg", "index.ts"),
      "export const ignored = true;\n",
    );
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".git", "config"), "ignored");
    fs.mkdirSync(path.join(tmpDir, ".docuvia"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".docuvia", "some.ts"),
      "export const ignored2 = true;\n",
    );

    fs.writeFileSync(
      path.join(tmpDir, "included.ts"),
      "export const included = true;\n",
    );
    fs.writeFileSync(path.join(tmpDir, "notes.md"), "# notes\n");
    fs.writeFileSync(path.join(tmpDir, "image.png"), Buffer.from([0, 1, 2]));

    const { files, droppedFiles } = collectSourceFiles(
      tmpDir,
      tmpDir,
      createMockLogger(),
    );

    expect(files.map((f) => f.relativePath)).toEqual(["included.ts"]);
    expect(droppedFiles).toEqual([]);
  });

  it("caps at MAX_ANALYZE_FILES files and reports the rest in droppedFiles", () => {
    const total = MAX_ANALYZE_FILES + 5;
    for (let i = 0; i < total; i++) {
      fs.writeFileSync(
        path.join(tmpDir, `file-${String(i).padStart(3, "0")}.ts`),
        `// file ${i}\n`,
      );
    }

    const { files, droppedFiles } = collectSourceFiles(
      tmpDir,
      tmpDir,
      createMockLogger(),
    );

    expect(files.length).toBe(MAX_ANALYZE_FILES);
    expect(droppedFiles.length).toBe(5);
  });

  it("caps at MAX_ANALYZE_BYTES cumulative bytes, dropping the file(s) that would cross it", () => {
    const chunkSize = 60_000;
    const chunk = "x".repeat(chunkSize);
    // 4 files of 60,000 bytes = 240,000 > MAX_ANALYZE_BYTES (200,000); the 4th should be dropped.
    for (let i = 0; i < 4; i++) {
      fs.writeFileSync(path.join(tmpDir, `big-${i}.ts`), `// ${chunk}${i}\n`);
    }

    const { files, droppedFiles } = collectSourceFiles(
      tmpDir,
      tmpDir,
      createMockLogger(),
    );

    const totalCollectedBytes = files.reduce(
      (sum, f) => sum + f.content.length,
      0,
    );
    expect(totalCollectedBytes).toBeLessThanOrEqual(MAX_ANALYZE_BYTES);
    expect(droppedFiles.length).toBeGreaterThanOrEqual(1);
    expect(files.length + droppedFiles.length).toBe(4);
  });

  it("collects just the one file when resolvedPath is a single file, not a directory", () => {
    const filePath = path.join(tmpDir, "single.ts");
    fs.writeFileSync(filePath, "export const one = 1;\n");

    const { files, droppedFiles } = collectSourceFiles(
      filePath,
      tmpDir,
      createMockLogger(),
    );

    expect(files).toEqual([
      { relativePath: "single.ts", content: "export const one = 1;\n" },
    ]);
    expect(droppedFiles).toEqual([]);
  });

  it("skips a file that throws on read (e.g. EACCES) from both files and droppedFiles, and warns via the logger", () => {
    const badPath = path.join(tmpDir, "unreadable.ts");
    fs.writeFileSync(badPath, "export const bad = 1;\n");
    const goodPath = path.join(tmpDir, "good.ts");
    fs.writeFileSync(goodPath, "export const good = 1;\n");

    const realReadFileSync = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((
      p: fs.PathOrFileDescriptor,
      opts?: any,
    ) => {
      if (typeof p === "string" && p === badPath) {
        const err: NodeJS.ErrnoException = new Error(
          "EACCES: permission denied",
        );
        err.code = "EACCES";
        throw err;
      }
      return realReadFileSync(p, opts);
    }) as typeof fs.readFileSync);

    const logger = createMockLogger();
    const { files, droppedFiles } = collectSourceFiles(tmpDir, tmpDir, logger);

    expect(files.map((f) => f.relativePath)).toEqual(["good.ts"]);
    expect(droppedFiles).toEqual([]);
    expect(
      logger.events.some(
        (e) =>
          e.level === "warn" &&
          e.message.toLowerCase().includes("failed to read file"),
      ),
    ).toBe(true);
  });
});

describe("collectSourceFiles() boundary validation (issue #162)", () => {
  let tmpDir: string;
  let outsideDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-boundary-test-"));
    outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-boundary-outside-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("rejects a symlinked file inside the tree that resolves outside workspaceRoot", () => {
    // Create a source file in outsideDir
    const secretFile = path.join(outsideDir, "secret.ts");
    fs.writeFileSync(secretFile, "export const secret = 1;\n");

    // Create a symlink inside tmpDir pointing to the outside file
    const symlinkFile = path.join(tmpDir, "escape-file.ts");
    fs.symlinkSync(secretFile, symlinkFile);

    const logger = createMockLogger();
    const { files } = collectSourceFiles(tmpDir, tmpDir, logger);

    // The symlinked file should be filtered out by the per-file boundary check
    expect(files).toHaveLength(0);
  });

  it("collects normal (non-symlinked) files within workspaceRoot", () => {
    fs.writeFileSync(
      path.join(tmpDir, "normal.ts"),
      "export const normal = 1;\n",
    );

    const { files, droppedFiles } = collectSourceFiles(
      tmpDir,
      tmpDir,
      createMockLogger(),
    );

    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe("normal.ts");
    expect(droppedFiles).toEqual([]);
  });

  it("collects symlinks that resolve within workspaceRoot", () => {
    // Create a real file inside tmpDir
    const realFile = path.join(tmpDir, "real.ts");
    fs.writeFileSync(realFile, "export const real = 1;\n");

    // Create a symlink inside tmpDir pointing to the real file
    const symlinkFile = path.join(tmpDir, "link.ts");
    fs.symlinkSync(realFile, symlinkFile);

    const { files } = collectSourceFiles(tmpDir, tmpDir, createMockLogger());

    // Should collect both the real file and the symlink
    expect(files.length).toBeGreaterThanOrEqual(1);
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain("real.ts");
  });

  it("returns empty files when resolvedPath resolves outside workspaceRoot", () => {
    // Create a file in outsideDir
    fs.writeFileSync(
      path.join(outsideDir, "secret.ts"),
      "export const secret = 1;\n",
    );

    const logger = createMockLogger();
    const { files } = collectSourceFiles(outsideDir, tmpDir, logger);

    expect(files).toHaveLength(0);
  });

  it("returns empty when resolvedPath is a symlink pointing outside workspaceRoot", () => {
    // Create a file in outsideDir
    fs.writeFileSync(
      path.join(outsideDir, "secret.ts"),
      "export const secret = 1;\n",
    );

    // Create a symlink inside tmpDir that points to outsideDir
    const symlinkPath = path.join(tmpDir, "escape-symlink");
    fs.symlinkSync(outsideDir, symlinkPath);

    const logger = createMockLogger();
    const { files } = collectSourceFiles(symlinkPath, tmpDir, logger);

    expect(files).toHaveLength(0);
  });
});
