import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSystem1ProjectOptions } from "./system1-tsconfig.js";

describe("System-1 snapshot tsconfig parsing", () => {
  it("parses JSONC, extends, and paths without baseUrl from tracked files", () => {
    const snapshotRoot = "/snapshot";
    const files = new Map([
      [
        "tsconfig.json",
        `{"extends":"./base.json","compilerOptions":{"target":"ES2022",},"include":["src/**/*.ts"]}`,
      ],
      ["base.json", `{"compilerOptions":{"paths":{"@opal/*":["./src/*"]}}}`],
      ["src/index.ts", "export {};"],
    ]);

    const result = parseSystem1ProjectOptions({
      configPath: path.join(snapshotRoot, "tsconfig.json"),
      snapshotRoot,
      trackedFiles: new Set(files.keys()),
      readText: (file) => files.get(file),
    });

    expect(result.parsed).toBe(true);
    expect(result.options.paths).toEqual({ "@opal/*": ["./src/*"] });
    expect(result.options.pathsBasePath).toBe(snapshotRoot);
  });

  it("does not read an extends file outside the tracked snapshot", () => {
    const snapshotRoot = "/snapshot";
    const files = new Map([
      ["tsconfig.json", `{"extends":"../outside/base.json"}`],
    ]);

    const result = parseSystem1ProjectOptions({
      configPath: path.join(snapshotRoot, "tsconfig.json"),
      snapshotRoot,
      trackedFiles: new Set(files.keys()),
      readText: (file) => files.get(file),
    });

    expect(result.parsed).toBe(false);
    expect(result.options.paths).toBeUndefined();
  });
});
