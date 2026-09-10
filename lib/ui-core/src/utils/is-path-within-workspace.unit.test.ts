import { describe, it, expect } from "vitest";
import path from "node:path";
import { isPathWithinWorkspace } from "./is-path-within-workspace.js";

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
