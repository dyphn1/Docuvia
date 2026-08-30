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

  it("resolves a same-package, no-import Go cross-file call via directory-scoped locals (roadmap item 19)", () => {
    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile("a.go", [], [], ["Foo"]);
    resolver.registerFile("b.go", [], [], ["Bar"]);

    const result = resolver.resolveCall("b.go", "Foo");
    expect(result).toEqual({ targetFile: "a.go", targetSymbol: "Foo" });
  });

  it("does not resolve a same-directory, no-import cross-file call for non-Go files (TS/JS still require an explicit import)", () => {
    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile("a.ts", [], [], ["foo"]);
    resolver.registerFile("b.ts", [], [], ["bar"]);

    const result = resolver.resolveCall("b.ts", "foo");
    expect(result).toBeNull();
  });

  it("refuses to resolve a tsconfig path alias that traverses outside the workspace root (issue #208)", () => {
    // A malicious/compromised tsconfig maps an alias at "../../secrets" -- even though such a
    // file "exists" (mocked), the containment check must reject the escape instead of reading it.
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("tsconfig.json")) return true;
      return sp.includes("/secrets/");
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("tsconfig.json")) {
        return JSON.stringify({
          compilerOptions: {
            paths: { "@evil/*": ["../../secrets"] },
          },
        });
      }
      return "";
    });
    vi.spyOn(fs, "statSync").mockImplementation(((p: any) => {
      if (String(p).includes("/secrets/")) {
        return { isFile: () => true };
      }
      throw new Error(`File not found: ${p}`);
    }) as any);

    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile(
      "src/consumer.ts",
      [
        {
          localName: "steal",
          originalName: "steal",
          modulePath: "@evil/keychain",
        },
      ],
      [],
      [],
    );

    expect(resolver.resolveCall("src/consumer.ts", "steal")).toBeNull();
  });

  // ── Issue #192 gap 2: barrel re-export chains ──────────────────────────
  function mockBarrelFilesystem(): void {
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("tsconfig.json") || sp.endsWith("tsconfig.base.json"))
        return false;
      if (sp.endsWith("src/mid/index.ts")) return true;
      if (sp.endsWith("src/deep/util.ts")) return true;
      return false;
    });
  }

  it("resolves an import through a barrel re-export to the defining file (issue #192 gap 2)", () => {
    mockBarrelFilesystem();

    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile("src/deep/util.ts", [], [], ["evalChainHelper"]);
    // The barrel itself defines nothing but re-exports the symbol from ../deep/util.
    resolver.registerFile(
      "src/mid/index.ts",
      [
        {
          localName: "evalChainHelper",
          originalName: "evalChainHelper",
          modulePath: "../deep/util",
        },
      ],
      [],
      [],
    );
    resolver.registerFile(
      "src/app-main.ts",
      [
        {
          localName: "evalChainHelper",
          originalName: "evalChainHelper",
          modulePath: "./mid",
        },
      ],
      [],
      [],
    );

    const result = resolver.resolveCall("src/app-main.ts", "evalChainHelper");
    expect(result).toEqual({
      targetFile: "src/deep/util.ts",
      targetSymbol: "evalChainHelper",
    });
  });

  it("follows the re-export alias back to the ORIGINAL name in the defining file (export { A as B })", () => {
    mockBarrelFilesystem();

    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile("src/deep/util.ts", [], [], ["originalName"]);
    resolver.registerFile(
      "src/mid/index.ts",
      [
        {
          localName: "outwardAlias",
          originalName: "originalName",
          modulePath: "../deep/util",
        },
      ],
      [],
      [],
    );
    resolver.registerFile(
      "src/consumer.ts",
      [
        {
          localName: "outwardAlias",
          originalName: "outwardAlias",
          modulePath: "./mid",
        },
      ],
      [],
      [],
    );

    expect(resolver.resolveCall("src/consumer.ts", "outwardAlias")).toEqual({
      targetFile: "src/deep/util.ts",
      targetSymbol: "originalName",
    });
  });

  it("falls back to the barrel file itself when the re-export chain dead-ends (prior behavior floor)", () => {
    mockBarrelFilesystem();

    const resolver = new ScopeResolver(workspaceRoot);
    // util does NOT define evalChainHelper; the re-export points nowhere real.
    resolver.registerFile("src/deep/util.ts", [], [], []);
    resolver.registerFile(
      "src/mid/index.ts",
      [
        {
          localName: "evalChainHelper",
          originalName: "evalChainHelper",
          modulePath: "../deep/util",
        },
      ],
      [],
      [],
    );
    resolver.registerFile(
      "src/app-main.ts",
      [
        {
          localName: "evalChainHelper",
          originalName: "evalChainHelper",
          modulePath: "./mid",
        },
      ],
      [],
      [],
    );

    const result = resolver.resolveCall("src/app-main.ts", "evalChainHelper");
    expect(result).toEqual({
      targetFile: "src/mid/index.ts",
      targetSymbol: "evalChainHelper",
    });
  });

  it("guards against mutually-recursive re-export cycles (terminates, no infinite loop)", () => {
    mockBarrelFilesystem();

    const reExportFooFromB = [
      { localName: "foo", originalName: "foo", modulePath: "../b/b" },
    ];
    const reExportFooFromA = [
      { localName: "foo", originalName: "foo", modulePath: "../a/a" },
    ];
    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile("src/a/a.ts", reExportFooFromB, [], []);
    resolver.registerFile("src/b/b.ts", reExportFooFromA, [], []);
    resolver.registerFile(
      "src/consumer.ts",
      [{ localName: "foo", originalName: "foo", modulePath: "./a/a" }],
      [],
      [],
    );
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("tsconfig.json") || sp.endsWith("tsconfig.base.json"))
        return false;
      if (sp.endsWith("src/a/a.ts") || sp.endsWith("src/b/b.ts")) return true;
      return false;
    });

    const result = resolver.resolveCall("src/consumer.ts", "foo");
    // Falls back to the first hop's file rather than looping forever -- same floor as a
    // dead-ending chain.
    expect(result?.targetFile).toBe("src/a/a.ts");
  });
});

// ── Issue #192 root-cause fix: member-call resolution (resolveMemberCall) ─────────────

describe("ScopeResolver.resolveMemberCall", () => {
  const workspaceRoot = "/mock/workspace";

  beforeEach(() => {
    vi.resetAllMocks();
    // No tsconfig files -- keep module resolution to plain relative paths.
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("tsconfig.json") || sp.endsWith("tsconfig.base.json"))
        return false;
      if (sp.endsWith("src/state/store.ts")) return true;
      return false;
    });
    vi.spyOn(fs, "statSync").mockImplementation((p: any) => {
      const sp = String(p).replace(/\\/g, "/");
      if (sp.endsWith("src/state/store.ts")) {
        return { isFile: () => true } as any;
      }
      throw new Error(`File not found: ${p}`);
    });
  });

  it("resolves a this-receiver call to a same-file method", () => {
    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile("src/service.ts", [], [], ["refresh", "helper"]);

    expect(
      resolver.resolveMemberCall("src/service.ts", "this", "refresh"),
    ).toEqual({ targetFile: "src/service.ts", targetSymbol: "refresh" });
  });

  it("returns null for a this-receiver whose method is not defined in the file (inherited, not guessed)", () => {
    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile("src/service.ts", [], [], ["refresh"]);

    expect(
      resolver.resolveMemberCall("src/service.ts", "this", "toString"),
    ).toBeNull();
  });

  it("resolves an import-binding receiver's method in the defining module", () => {
    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile(
      "src/app/main.ts",
      [
        {
          localName: "store",
          originalName: "store",
          modulePath: "../state/store.js",
        },
      ],
      [],
      [],
    );
    // The defining module declares the method as a local symbol.
    resolver.registerFile("src/state/store.ts", [], [], ["commit"]);

    expect(
      resolver.resolveMemberCall("src/app/main.ts", "store", "commit"),
    ).toEqual({ targetFile: "src/state/store.ts", targetSymbol: "commit" });
  });

  it("falls back to a same-file local for a non-import receiver (static/local-object heuristic)", () => {
    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile("src/math.ts", [], [], ["round"]);

    expect(
      resolver.resolveMemberCall("src/math.ts", "Numbers", "round"),
    ).toEqual({ targetFile: "src/math.ts", targetSymbol: "round" });
  });

  it("refuses an unknown receiver with no same-file candidate (no project-wide guessing)", () => {
    const resolver = new ScopeResolver(workspaceRoot);
    resolver.registerFile("src/a.ts", [], [], []);
    resolver.registerFile("src/b.ts", [], [], ["close"]);

    expect(resolver.resolveMemberCall("src/a.ts", "conn", "close")).toBeNull();
  });

  // ── Issue #230: receiver imported through a barrel ────────────────────────────────────
  describe("member call whose receiver is re-exported by a barrel (issue #230)", () => {
    const CHAIN_FILES = [
      "src/contracts/index.ts",
      "src/contracts/factory/docuvia-factory.ts",
    ];

    beforeEach(() => {
      // Widen the suite-level fs mock so the barrel and its declaring module resolve on disk.
      vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
        const sp = String(p).replace(/\\/g, "/");
        if (sp.endsWith("tsconfig.json") || sp.endsWith("tsconfig.base.json"))
          return false;
        return CHAIN_FILES.some((f) => sp.endsWith(f));
      });
      vi.spyOn(fs, "statSync").mockImplementation((p: any) => {
        const sp = String(p).replace(/\\/g, "/");
        if (CHAIN_FILES.some((f) => sp.endsWith(f))) {
          return { isFile: () => true } as any;
        }
        throw new Error(`File not found: ${p}`);
      });
    });

    /** `import { docuviaFactory } from "<barrel>"; docuviaFactory.register(...)` — the barrel
     *  declares neither the receiver nor the method, so both pre-#230 lookups miss. */
    const registerBarrelChain = (resolver: ScopeResolver) => {
      resolver.registerFile(
        "src/app/main.ts",
        [
          {
            localName: "docuviaFactory",
            originalName: "docuviaFactory",
            modulePath: "../contracts/index.js",
          },
        ],
        [],
        [],
      );
      // Barrel: re-exports the receiver, declares nothing itself.
      resolver.registerFile(
        "src/contracts/index.ts",
        [
          {
            localName: "docuviaFactory",
            originalName: "docuviaFactory",
            modulePath: "./factory/docuvia-factory.js",
          },
        ],
        [],
        [],
      );
      // Declaring module: the receiver const plus the class methods (which
      // `registerResolverFiles` registers as locals alongside plain functions).
      resolver.registerFile(
        "src/contracts/factory/docuvia-factory.ts",
        [],
        [],
        ["docuviaFactory", "DocuviaFactory", "register", "resolve", "lock"],
      );
    };

    it("chases the receiver symbol through the barrel and finds the method at its declaration", () => {
      const resolver = new ScopeResolver(workspaceRoot);
      registerBarrelChain(resolver);

      expect(
        resolver.resolveMemberCall(
          "src/app/main.ts",
          "docuviaFactory",
          "register",
        ),
      ).toEqual({
        targetFile: "src/contracts/factory/docuvia-factory.ts",
        targetSymbol: "register",
      });
    });

    it("still refuses a method the receiver's declaring file does not declare (inherited, not guessed)", () => {
      const resolver = new ScopeResolver(workspaceRoot);
      registerBarrelChain(resolver);
      // Declared in some unrelated file — must NOT be matched project-wide.
      resolver.registerFile("src/elsewhere.ts", [], [], ["dispose"]);

      expect(
        resolver.resolveMemberCall(
          "src/app/main.ts",
          "docuviaFactory",
          "dispose",
        ),
      ).toBeNull();
    });
  });

  // ── Issue #230: call-origin classification for the `external` counter ─────────────────
  describe("isExternalBinding / hasBinding / declaresLocal (issue #230)", () => {
    const withImport = (modulePath: string) => {
      const resolver = new ScopeResolver(workspaceRoot);
      resolver.registerFile(
        "src/a.ts",
        [{ localName: "dep", originalName: "dep", modulePath }],
        [],
        ["localThing"],
      );
      return resolver;
    };

    it("classifies a `node:`-protocol builtin as external", () => {
      expect(withImport("node:fs").isExternalBinding("src/a.ts", "dep")).toBe(
        true,
      );
    });

    it("classifies a bare npm specifier that resolves nowhere as external", () => {
      // No workspace package, no tsconfig alias, no node_modules dir on the mocked fs.
      expect(withImport("vitest").isExternalBinding("src/a.ts", "dep")).toBe(
        true,
      );
    });

    it("never classifies a relative specifier as external, even when it fails to resolve", () => {
      // A broken relative import is a resolver gap to fix, not evidence the callee is external —
      // laundering it into `external` would hide the very bugs this metric exists to surface.
      expect(
        withImport("./missing-file.js").isExternalBinding("src/a.ts", "dep"),
      ).toBe(false);
    });

    it("returns false for a name that has no import binding at all", () => {
      expect(
        withImport("node:fs").isExternalBinding("src/a.ts", "somethingElse"),
      ).toBe(false);
    });

    it("reports binding presence and local declarations independently of resolution", () => {
      const resolver = withImport("node:fs");
      expect(resolver.hasBinding("src/a.ts", "dep")).toBe(true);
      expect(resolver.hasBinding("src/a.ts", "nope")).toBe(false);
      expect(resolver.declaresLocal("src/a.ts", "localThing")).toBe(true);
      expect(resolver.declaresLocal("src/a.ts", "nope")).toBe(false);
    });

    it("normalizes Windows-style paths on every classification entry point", () => {
      const resolver = withImport("node:fs");
      expect(resolver.isExternalBinding("src\\a.ts", "dep")).toBe(true);
      expect(resolver.hasBinding("src\\a.ts", "dep")).toBe(true);
      expect(resolver.declaresLocal("src\\a.ts", "localThing")).toBe(true);
    });
  });
});
