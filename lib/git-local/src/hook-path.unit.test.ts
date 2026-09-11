import { describe, expect, it } from "vitest";
import path from "node:path";
import { ErrorCodes } from "@workspace/contracts";
import { resolveHookPathWithinDir } from "./hook-path.js";

const INVALID_HOOK_NAMES = [
  "../config",
  "nested/pre-push",
  "nested\\pre-push",
  ".",
  "..",
  "",
] as const;

function expectPathTraversal(fn: () => unknown): void {
  try {
    fn();
    throw new Error("expected hook path validation to reject");
  } catch (error) {
    expect(error).toMatchObject({ code: ErrorCodes.FS_PATH_TRAVERSAL });
  }
}

describe("resolveHookPathWithinDir()", () => {
  const hooksDir = path.resolve("repo", ".git", "hooks");

  it("resolves a valid hook basename beneath the hooks directory", () => {
    expect(resolveHookPathWithinDir(hooksDir, "post-commit")).toBe(
      path.join(hooksDir, "post-commit"),
    );
  });

  for (const hookName of INVALID_HOOK_NAMES) {
    it(`rejects path-like hook name ${JSON.stringify(hookName)}`, () => {
      expectPathTraversal(() => resolveHookPathWithinDir(hooksDir, hookName));
    });
  }

  it("rejects an absolute path", () => {
    const absolute = path.resolve(hooksDir, "..", "outside-hook");
    expectPathTraversal(() => resolveHookPathWithinDir(hooksDir, absolute));
  });
});
