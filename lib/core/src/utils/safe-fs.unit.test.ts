import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { readFileWithinRoot, resolveWithinRoot } from "./safe-fs.js";

describe("resolveWithinRoot()", () => {
  const root = path.join(os.tmpdir(), "docuvia-safe-fs-root");

  beforeAll(() => {
    fs.mkdirSync(path.join(root, "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "file.txt"), "hello");
    fs.writeFileSync(path.join(root, "nested", "deep.txt"), "deep");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("resolves a plain relative path inside the root", () => {
    expect(resolveWithinRoot("/ws", "lib/core/src/index.ts")).toBe(
      path.resolve("/ws", "lib/core/src/index.ts"),
    );
  });

  it("accepts nested ./ relative paths", () => {
    expect(
      resolveWithinRoot("/ws", "./a/../b/c.ts"),
      // resolves lexically to /ws/b/c.ts -- still inside the root
    ).toBe(path.resolve("/ws/b/c.ts"));
  });

  it("returns the root itself for an empty relative path", () => {
    expect(resolveWithinRoot("/ws", ".")).toBe(path.resolve("/ws"));
  });

  it("returns null on ../ traversal escaping the root (issue #208)", () => {
    expect(resolveWithinRoot("/ws", "../outside.ts")).toBeNull();
    expect(resolveWithinRoot("/ws", "lib/../../../etc/passwd")).toBeNull();
  });

  it("returns null for an absolute path pointing outside the root", () => {
    expect(resolveWithinRoot("/ws", "/etc/passwd")).toBeNull();
  });
});

describe("readFileWithinRoot()", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-safe-fs-read-"));

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads an existing file inside the root", () => {
    fs.writeFileSync(path.join(root, "ok.txt"), "content");
    expect(readFileWithinRoot(root, "ok.txt")).toBe("content");
  });

  it("returns null for a missing file", () => {
    expect(readFileWithinRoot(root, "missing.txt")).toBeNull();
  });

  it("returns null instead of reading when the relative path traverses out of the root (issue #208)", () => {
    const outside = path.join(os.tmpdir(), "docuvia-safe-fs-outside.txt");
    fs.writeFileSync(outside, "secret");
    try {
      expect(
        readFileWithinRoot(root, `../${path.basename(outside)}`),
      ).toBeNull();
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
