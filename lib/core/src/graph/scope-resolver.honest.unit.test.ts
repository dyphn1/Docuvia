import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ScopeResolver } from "./scope-resolver.js";

/**
 * Real-filesystem import-resolution tests (issue #234): no `vi.mock("fs")` —
 * files, tsconfig and existence checks all hit a real temp workspace, so these
 * fail if resolution ever stops working on disk (the mock-fs suite cannot).
 */
describe("ScopeResolver with real files (issue #234)", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-scope-real-"),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, content: string): void {
    const full = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  it("resolves a relative .js-suffixed import to the real .ts source with its symbol", () => {
    writeFile("src/b.ts", "export function foo() { return 1; }\n");
    writeFile("src/a.ts", 'import { foo } from "./b.js";\nfoo();\n');

    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile(
      "src/a.ts",
      [{ localName: "foo", originalName: "foo", modulePath: "./b.js" }],
      [],
      [],
    );

    expect(resolver.resolveCall("src/a.ts", "foo")).toEqual({
      targetFile: "src/b.ts",
      targetSymbol: "foo",
    });
  });

  it("resolves an import through a real tsconfig paths mapping", () => {
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@alias/*": ["src/*"] } } }),
    );
    writeFile("src/b.ts", "export function foo() { return 1; }\n");
    writeFile("src/a.ts", 'import { foo } from "@alias/b";\nfoo();\n');

    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile(
      "src/a.ts",
      [{ localName: "foo", originalName: "foo", modulePath: "@alias/b" }],
      [],
      [],
    );

    expect(resolver.resolveCall("src/a.ts", "foo")).toEqual({
      targetFile: "src/b.ts",
      targetSymbol: "foo",
    });
  });

  it("returns null for an import whose target file does not exist on disk", () => {
    writeFile("src/a.ts", 'import { ghost } from "./missing.js";\n');

    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile(
      "src/a.ts",
      [
        {
          localName: "ghost",
          originalName: "ghost",
          modulePath: "./missing.js",
        },
      ],
      [],
      [],
    );

    expect(resolver.resolveCall("src/a.ts", "ghost")).toBeNull();
  });
});
