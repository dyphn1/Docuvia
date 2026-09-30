import { describe, expect, it } from "vitest";
import { isDiscoverableSourceFile, isDocuviaGeneratedPath } from "../index.js";

describe("Docuvia-generated source paths", () => {
  it("[happy] recognizes both generated hook scripts by exact repo-relative path", () => {
    expect(isDocuviaGeneratedPath(".claude/hooks/docuvia-hook.js")).toBe(true);
    expect(isDocuviaGeneratedPath(".cursor/hooks/docuvia-hook.cjs")).toBe(true);
  });

  it("[happy] normalizes Windows separators before matching generated hook paths", () => {
    expect(isDocuviaGeneratedPath(".claude\\hooks\\docuvia-hook.js")).toBe(
      true,
    );
    expect(isDocuviaGeneratedPath(".cursor\\hooks\\docuvia-hook.cjs")).toBe(
      true,
    );
  });

  it("[invalid-input] keeps user hook-like files outside the generated paths discoverable", () => {
    const userPaths = ["src/hooks/docuvia-hook.js", ".claude/hooks/my-hook.js"];

    for (const filePath of userPaths) {
      expect(isDocuviaGeneratedPath(filePath)).toBe(false);
      expect(isDiscoverableSourceFile(filePath)).toBe(true);
    }
  });

  it("[invalid-input] requires an exact repo-relative path match", () => {
    expect(isDocuviaGeneratedPath("src/.claude/hooks/docuvia-hook.js")).toBe(
      false,
    );
    expect(isDocuviaGeneratedPath("/repo/.claude/hooks/docuvia-hook.js")).toBe(
      false,
    );
  });

  it("[error-handling] fails closed to not-generated for degenerate paths without throwing", () => {
    for (const filePath of ["", ".", ".claude/hooks/", "docuvia-hook.js"]) {
      expect(() => isDocuviaGeneratedPath(filePath)).not.toThrow();
      expect(isDocuviaGeneratedPath(filePath)).toBe(false);
    }
    // The generated hooks are also rejected by the full discoverability rule.
    expect(isDiscoverableSourceFile(".claude/hooks/docuvia-hook.js")).toBe(
      false,
    );
    expect(isDiscoverableSourceFile(".cursor/hooks/docuvia-hook.cjs")).toBe(
      false,
    );
  });
});
