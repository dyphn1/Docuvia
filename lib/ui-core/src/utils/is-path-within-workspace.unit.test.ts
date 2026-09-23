import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isPathWithinWorkspace,
  resolveExistingPathWithinWorkspace,
} from "./is-path-within-workspace.js";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSource(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "export const x = 1;\n");
}

describe("isPathWithinWorkspace (issues #266/#267)", () => {
  const root = path.join("tmp", "ws");

  it("accepts the root itself and nested paths", () => {
    expect(isPathWithinWorkspace(root, root)).toBe(true);
    expect(
      isPathWithinWorkspace(path.join(root, ".docuvia", "local.db"), root),
    ).toBe(true);
  });

  it("rejects parent and sibling escapes, including dot-dot segments", () => {
    expect(isPathWithinWorkspace(path.join(root, "..", "evil"), root)).toBe(
      false,
    );
    expect(
      isPathWithinWorkspace(path.join(root, "..", "ws-evil", "x"), root),
    ).toBe(false);
  });

  it("rejects prefix-sibling paths that share a string prefix", () => {
    expect(isPathWithinWorkspace(`${root}-evil`, root)).toBe(false);
  });
});

describe("resolveExistingPathWithinWorkspace (issue #471)", () => {
  it("[happy] accepts a canonical in-workspace path", () => {
    const root = makeTempDir("docuvia-path-safe-");
    try {
      const target = path.join(root, "src", "safe.ts");
      writeSource(target);

      expect(resolveExistingPathWithinWorkspace(target, root)).toEqual({
        status: "ok",
        resolvedPath: path.resolve(target),
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("[invalid-input] rejects an absolute outside path", () => {
    const root = makeTempDir("docuvia-path-root-");
    const outside = makeTempDir("docuvia-path-outside-");
    try {
      const target = path.join(outside, "outside.ts");
      writeSource(target);

      expect(resolveExistingPathWithinWorkspace(target, root)).toEqual({
        status: "outside",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("[error-handling] rejects a symlink or junction escape", () => {
    const root = makeTempDir("docuvia-path-root-");
    const outside = makeTempDir("docuvia-path-outside-");
    try {
      const outsideFile = path.join(outside, "outside.ts");
      writeSource(outsideFile);
      const link = path.join(root, "linked");
      fs.symlinkSync(
        outside,
        link,
        process.platform === "win32" ? "junction" : "dir",
      );

      const linkedFile = path.join(link, "outside.ts");
      expect(resolveExistingPathWithinWorkspace(linkedFile, root)).toEqual({
        status: "outside",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("[invalid-input] reports a missing in-workspace path", () => {
    const root = makeTempDir("docuvia-path-missing-");
    try {
      const missing = path.join(root, "missing.ts");
      expect(resolveExistingPathWithinWorkspace(missing, root)).toEqual({
        status: "missing",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
