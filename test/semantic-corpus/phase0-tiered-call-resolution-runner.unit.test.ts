import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendRows,
  isTrackedSafetyRelevantPath,
} from "../../scripts/semantic-corpus/phase0-tiered-call-resolution-runner.mts";
import { MAX_FILE_SIZE_BYTES } from "../../lib/contracts/src/index.js";
import {
  preflightSnapshotPaths,
  readSnapshotSourceFile,
} from "../../scripts/semantic-corpus/phase0-snapshot-safety.mts";
import { hashSnapshot } from "../../scripts/semantic-corpus/snapshot.mts";

const tempRoots: string[] = [];
const runnerPath = fileURLToPath(
  new URL(
    "../../scripts/semantic-corpus/phase0-tiered-call-resolution-runner.mts",
    import.meta.url,
  ),
);

function makeSnapshot(): string {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "docuvia-phase0-source-test-"),
  );
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("phase 0 pinned source reader", () => {
  it("[happy] appends large corpus batches without spread-argument limits", () => {
    const target: number[] = [];
    const source = Array.from({ length: 220_000 }, (_, index) => index);

    appendRows(target, source);

    expect(target).toHaveLength(source.length);
    expect(target[0]).toBe(0);
    expect(target.at(-1)).toBe(219_999);
  });

  it("[happy] includes uppercase discoverable sources in preflight before Tier A", () => {
    expect(isTrackedSafetyRelevantPath("src/unsafe.TS")).toBe(true);
    expect(isTrackedSafetyRelevantPath("src/unsafe.JsX")).toBe(true);
    expect(isTrackedSafetyRelevantPath("tsconfig.json")).toBe(true);
    expect(isTrackedSafetyRelevantPath("notes.md")).toBe(false);
  });

  it("[happy] runner entrypoint help loads its full module graph without corpus access", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", runnerPath, "--help"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Usage: phase0-tiered-call-resolution-runner.mts",
    );
    expect(result.stdout).not.toContain("[phase0] 1/");
  });

  it("[invalid-input] runner entrypoint rejects unknown options before reading the corpus", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", runnerPath, "--unknown", "value"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unknown or incomplete option: --unknown");
    expect(result.stderr).not.toContain("Pinned corpus has no samples");
  });

  it("[happy] reads a regular source file contained by the snapshot", () => {
    const root = makeSnapshot();
    mkdirSync(path.join(root, "src"));
    writeFileSync(
      path.join(root, "src", "call.ts"),
      "export const call = 1;\n",
    );

    const result = readSnapshotSourceFile(root, "src/call.ts", 128);

    expect(result.status).toBe("readable");
    if (result.status === "readable")
      expect(result.bytes.toString("utf8")).toBe("export const call = 1;\n");
  });

  it("[happy] soft-skips an oversized vendor source without losing caller hash", () => {
    const root = makeSnapshot();
    const caller = Buffer.from("export const caller = () => 1;\n");
    mkdirSync(path.join(root, "vendor"));
    writeFileSync(path.join(root, "caller.ts"), caller);
    writeFileSync(
      path.join(root, "vendor", "parser.c"),
      Buffer.alloc(MAX_FILE_SIZE_BYTES + 1),
    );
    expect(
      spawnSync("git", ["init", "-q", "-b", "main"], {
        cwd: root,
        encoding: "utf8",
      }).status,
    ).toBe(0);
    expect(spawnSync("git", ["add", "-A"], { cwd: root }).status).toBe(0);
    expect(
      spawnSync(
        "git",
        [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.invalid",
          "commit",
          "-q",
          "-m",
          "snapshot",
        ],
        { cwd: root },
      ).status,
    ).toBe(0);

    const preflight = preflightSnapshotPaths(root, [
      "caller.ts",
      "vendor/parser.c",
    ]);
    const snapshot = hashSnapshot(root);

    expect(preflight.exclusions).toEqual([]);
    expect(preflight.oversizedSourceFiles).toEqual([
      { path: "vendor/parser.c", sizeBytes: MAX_FILE_SIZE_BYTES + 1 },
    ]);
    expect(snapshot.files.has("caller.ts")).toBe(true);
    expect(snapshot.files.has("vendor/parser.c")).toBe(false);
    expect(snapshot.files.get("caller.ts")).toBe(
      createHash("sha256").update(caller).digest("hex"),
    );
  });

  it("[invalid-input] hard-excludes unsafe paths and oversized hash inputs", () => {
    const root = makeSnapshot();
    const outside = path.join(
      os.tmpdir(),
      `docuvia-phase0-outside-${process.pid}.ts`,
    );
    writeFileSync(outside, "secret outside snapshot");
    try {
      symlinkSync(outside, path.join(root, "outside.ts"));
      writeFileSync(
        path.join(root, "large.ts"),
        Buffer.alloc(MAX_FILE_SIZE_BYTES + 1),
      );
      writeFileSync(
        path.join(root, "large.TS"),
        Buffer.alloc(MAX_FILE_SIZE_BYTES + 1),
      );
      writeFileSync(
        path.join(root, "large.py"),
        Buffer.alloc(MAX_FILE_SIZE_BYTES + 1),
      );
      writeFileSync(
        path.join(root, "package.json"),
        Buffer.alloc(MAX_FILE_SIZE_BYTES + 1),
      );

      expect(readSnapshotSourceFile(root, "outside.ts", 128)).toEqual({
        status: "excluded",
        reason: "source-file-symlink",
      });
      expect(readSnapshotSourceFile(root, "../outside.ts", 128)).toEqual({
        status: "excluded",
        reason: "source-file-path-escapes-snapshot",
      });
      expect(readSnapshotSourceFile(root, "large.ts", 4)).toEqual({
        status: "excluded",
        reason: "source-file-over-discovery-size-limit",
      });
      const preflight = preflightSnapshotPaths(root, [
        "outside.ts",
        "large.ts",
        "large.TS",
        "large.py",
        "package.json",
      ]);

      expect(preflight.exclusions).toEqual([
        { path: "outside.ts", reason: "source-file-symlink" },
        {
          path: "large.ts",
          reason: "source-file-over-discovery-size-limit",
        },
        {
          path: "package.json",
          reason: "tracked-file-over-size-limit",
        },
      ]);
      expect(preflight.oversizedSourceFiles).toEqual([
        { path: "large.TS", sizeBytes: MAX_FILE_SIZE_BYTES + 1 },
        { path: "large.py", sizeBytes: MAX_FILE_SIZE_BYTES + 1 },
      ]);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("[error-handling] excludes missing and non-regular paths without reading them", () => {
    const root = makeSnapshot();
    mkdirSync(path.join(root, "directory"));

    expect(readSnapshotSourceFile(root, "missing.ts", 128)).toEqual({
      status: "excluded",
      reason: "source-file-not-regular",
    });
    expect(readSnapshotSourceFile(root, "directory", 128)).toEqual({
      status: "excluded",
      reason: "source-file-not-regular",
    });
    expect(readSnapshotSourceFile(root, "src/../missing.ts", 128)).toEqual({
      status: "excluded",
      reason: "source-file-path-escapes-snapshot",
    });
  });
});
