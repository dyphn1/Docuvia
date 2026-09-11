import { describe, it, expect } from "vitest";
import path from "node:path";
import { ErrorCodes } from "@workspace/contracts";
import { resolveLspWorkspacePath } from "./lsp-workspace-path.js";

function expectTraversal(fn: () => unknown): void {
  try {
    fn();
    throw new Error("expected workspace path validation to reject");
  } catch (error) {
    expect(error).toMatchObject({ code: ErrorCodes.FS_PATH_TRAVERSAL });
  }
}

describe("resolveLspWorkspacePath()", () => {
  const workspaceRoot = path.resolve("workspace");

  it("resolves a normal relative source path within the workspace", () => {
    expect(resolveLspWorkspacePath(workspaceRoot, "src/example.ts")).toBe(
      path.join(workspaceRoot, "src", "example.ts"),
    );
  });

  it("rejects parent traversal outside the workspace", () => {
    expectTraversal(() =>
      resolveLspWorkspacePath(workspaceRoot, "../outside-secret.txt"),
    );
  });

  it("rejects an absolute path outside the workspace", () => {
    const outside = path.resolve(workspaceRoot, "..", "outside-secret.txt");
    expectTraversal(() => resolveLspWorkspacePath(workspaceRoot, outside));
  });
});
