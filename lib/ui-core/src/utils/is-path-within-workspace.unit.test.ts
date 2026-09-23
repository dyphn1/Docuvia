import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isPathWithinWorkspace,
  resolveExistingPathWithinWorkspace,
} from "./is-path-within-workspace.js";

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
  it(
    "[happy] accepts an existing file whose canonical path stays inside the workspace",
    () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "docuvia-path-safe-"),
      );
      try {
        const target = path.join(root, "src", "safe.ts");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "export const safe = true;\n");

        expect(resolveExistingPathWithinWorkspace(target, root)).toEqual({
          status: "ok",
          resolvedPath: path.resolve(target),
        });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("[invalid-input] rejects an absolute path outside the workspace", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-path-root-"),
    );
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-path-outside-"),
    );
    try {
      const target = path.join(outside, "outside.ts");
      fs.writeFileSync(target, "export const outside = true;\n");

      expect(resolveExistingPathWithinWorkspace(target, root)).toEqual({
        status: "outside",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it(
    "[error-handling] rejects a workspace-local symlink or junction that resolves outside",
    () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "docuvia-path-root-"),
      );
      const outside = fs.mkdtempSync(
        path.join(os.tmpdir(), "docuvia-path-outside-"),
      );
      try {
        fs.writeFileSync(
          path.join(outside, "outside.ts"),
          "export const outside = true;\n",
        );
        const link = path.join(root, "linked");
        fs.symlinkSync(
          outside,
          link,
          process.platform === "win32" ? "junction" : "dir",
        );

        expect(
          resolveExistingPathWithinWorkspace(
            path.join(link, "outside.ts"),
            root,
          ),
        ).toEqual({ status: "outside" });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("[invalid-input] reports a missing in-workspace path without accepting it", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-path-missing-"),
    );
    try {
      expect(
        resolveExistingPathWithinWorkspace(path.join(root, "missing.ts"), root),
      ).toEqual({ status: "missing" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
