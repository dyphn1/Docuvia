import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScopeResolver } from "./scope-resolver";
import * as fs from "fs";
import * as path from "path";

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
      [{ localName: "someFunc", originalName: "someFunc", modulePath: "@workspace/core" }],
      [],
      []
    );

    const result = resolver.resolveCall("src/consumer.ts", "someFunc");
    expect(result).toEqual({
      targetFile: "lib/core/src/index.ts",
      targetSymbol: "someFunc",
    });
  });

  it("resolves a bare workspace-monorepo package import via pnpm-workspace.yaml + package.json name", () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("tsconfig.json") || sp.endsWith("tsconfig.base.json")) return false;
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
      if (sp.endsWith("lib/db/src/index.ts")) return { isFile: () => true } as any;
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
      [{ localName: "dbClient", originalName: "dbClient", modulePath: "@workspace/db" }],
      [],
      []
    );

    const result = resolver.resolveCall("src/consumer.ts", "dbClient");
    expect(result).toEqual({
      targetFile: "lib/db/src/index.ts",
      targetSymbol: "dbClient",
    });
  });
});
