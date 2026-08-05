import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScopeResolver } from "./scope-resolver.js";
import * as fs from "fs";

vi.mock("fs");

describe("ScopeResolver", () => {
  const workspaceRoot = "/mock/workspace";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should respect tsconfig.json path mappings", () => {
    // Mock tsconfig.json reading
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("tsconfig.json")) return true;
      if (sp.endsWith("tsconfig.base.json")) return false;
      if (sp.endsWith("lib/core/src/index.ts")) return true;
      return false;
    });

    vi.spyOn(fs, "readFileSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("tsconfig.json")) {
        return JSON.stringify({
          compilerOptions: {
            paths: {
              "@workspace/*": ["lib/*/src"],
            },
          },
        });
      }
      return "";
    });

    vi.spyOn(fs, "statSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("lib/core/src/index.ts")) {
        return { isFile: () => true } as any;
      }
      throw new Error(`File not found: ${p}`);
    });

    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile(
      "src/consumer.ts",
      [
        {
          localName: "someFunc",
          originalName: "someFunc",
          modulePath: "@workspace/core",
        },
      ],
      [],
      [],
    );

    const result = resolver.resolveCall("src/consumer.ts", "someFunc");
    expect(result).toEqual({
      targetFile: "lib/core/src/index.ts",
      targetSymbol: "someFunc",
    });
  });

  it("resolves a relative import whose specifier names a compiled .js extension to its real .ts source (TS NodeNext/ESM convention)", () => {
    // Regression guard for the vscode benchmark's "Disposable" edge-collapse bug
    // (docs/cli-test-analysis/typescript-cli-benchmark.md, Open Findings §1): vscode's own
    // source writes `import { Disposable } from "../../base/common/lifecycle.js"` even though
    // only `lifecycle.ts` exists on disk. The old append-only extension loop tried
    // `lifecycle.js.ts`/`lifecycle.js.js`/... and never the real `lifecycle.ts`, so every such
    // import failed to resolve and `persist-ast-graph.ts` fell back to a project-wide
    // name-based guess for the extends/implements edge instead of the real imported file.
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("tsconfig.json") || sp.endsWith("tsconfig.base.json"))
        return false;
      if (sp.endsWith("src/base/common/lifecycle.ts")) return true;
      return false;
    });
    vi.spyOn(fs, "statSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("src/base/common/lifecycle.ts")) {
        return { isFile: () => true } as any;
      }
      throw new Error(`File not found: ${p}`);
    });

    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile(
      "src/editor/codeEditorWidget.ts",
      [
        {
          localName: "Disposable",
          originalName: "Disposable",
          modulePath: "../base/common/lifecycle.js",
        },
      ],
      [],
      [],
    );

    const result = resolver.resolveCall(
      "src/editor/codeEditorWidget.ts",
      "Disposable",
    );
    expect(result).toEqual({
      targetFile: "src/base/common/lifecycle.ts",
      targetSymbol: "Disposable",
    });
  });

  it("resolves a bare workspace-monorepo package import via pnpm-workspace.yaml + package.json name", () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("tsconfig.json") || sp.endsWith("tsconfig.base.json"))
        return false;
      if (sp.endsWith("pnpm-workspace.yaml")) return true;
      if (sp.endsWith("/lib")) return true;
      if (sp.endsWith("lib/db/package.json")) return true;
      if (sp.endsWith("lib/db/src/index.ts")) return true;
      return false;
    });

    vi.spyOn(fs, "readFileSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("pnpm-workspace.yaml")) {
        return "packages:\n  - artifacts/*\n  - lib/*\n";
      }
      if (sp.endsWith("lib/db/package.json")) {
        return JSON.stringify({ name: "@workspace/db" });
      }
      return "";
    });

    vi.spyOn(fs, "statSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("lib/db/src/index.ts"))
        return { isFile: () => true } as any;
      throw new Error(`File not found: ${p}`);
    });

    vi.spyOn(fs, "readdirSync").mockImplementation((p: any, _opts: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("/lib")) {
        return [{ name: "db", isDirectory: () => true }] as any;
      }
      return [] as any;
    });

    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile(
      "src/consumer.ts",
      [
        {
          localName: "dbClient",
          originalName: "dbClient",
          modulePath: "@workspace/db",
        },
      ],
      [],
      [],
    );

    const result = resolver.resolveCall("src/consumer.ts", "dbClient");
    expect(result).toEqual({
      targetFile: "lib/db/src/index.ts",
      targetSymbol: "dbClient",
    });
  });
});
