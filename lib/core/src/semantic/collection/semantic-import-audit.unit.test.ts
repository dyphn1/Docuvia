import { describe, expect, it } from "vitest";
import {
  auditImportedTarget,
  resolveRelativeSpecifier,
  type ImportAuditInput,
  type ModuleSyntax,
} from "./semantic-import-audit.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-collection.md#c-04--population-and-independent-evidence
const files = new Set([
  "src/caller.ts",
  "src/util.ts",
  "src/lib/index.ts",
  "src/lib/impl.ts",
  "src/lib/other.ts",
  "src/esm.ts",
  "src/view.tsx",
]);
const modules: Record<string, ModuleSyntax> = {
  "src/util.ts": {
    declared: ["run", "Box", "logger"],
    classes: ["Box"],
    reexports: [],
  },
  "src/lib/index.ts": {
    declared: [],
    classes: [],
    reexports: [
      { exported: "go", imported: "start", specifier: "./impl" },
      { exported: "*", imported: "*", specifier: "./other" },
    ],
  },
  "src/lib/impl.ts": { declared: ["start"], classes: [], reexports: [] },
  "src/lib/other.ts": { declared: ["walk"], classes: [], reexports: [] },
  "src/esm.ts": { declared: ["esm"], classes: [], reexports: [] },
};
const input = (overrides: Partial<ImportAuditInput>): ImportAuditInput => ({
  callerFile: "src/caller.ts",
  calleeName: "run",
  calleeKind: "bare",
  receiverText: null,
  imports: [
    { local: "run", imported: "run", specifier: "./util" },
    { local: "go", imported: "go", specifier: "./lib" },
    { local: "walk", imported: "walk", specifier: "./lib/index.js" },
    { local: "u", imported: "*", specifier: "./util" },
    { local: "Box", imported: "Box", specifier: "./util" },
    { local: "logger", imported: "logger", specifier: "./util" },
    { local: "esm", imported: "esm", specifier: "./esm.js" },
    { local: "pkg", imported: "pkg", specifier: "some-package" },
  ],
  goldFiles: ["src/util.ts"],
  fileExists: (file) => files.has(file),
  moduleOf: (file) => modules[file],
  ...overrides,
});

describe("syntactic import audit", () => {
  it("[happy] resolves direct, aliased-through-barrel and star re-exports", () => {
    expect(auditImportedTarget(input({}))).toEqual({
      kind: "match",
      filePath: "src/util.ts",
    });
    expect(
      auditImportedTarget(
        input({ calleeName: "go", goldFiles: ["src/lib/impl.ts"] }),
      ),
    ).toEqual({ kind: "match", filePath: "src/lib/impl.ts" });
    expect(
      auditImportedTarget(
        input({ calleeName: "walk", goldFiles: ["src/lib/other.ts"] }),
      ),
    ).toEqual({ kind: "match", filePath: "src/lib/other.ts" });
  });

  it("[happy] audits namespace members and static calls on imported classes", () => {
    expect(
      auditImportedTarget(input({ calleeKind: "member", receiverText: "u" })),
    ).toEqual({ kind: "match", filePath: "src/util.ts" });
    expect(
      auditImportedTarget(
        input({
          calleeName: "make",
          calleeKind: "member",
          receiverText: "Box",
        }),
      ),
    ).toEqual({ kind: "match", filePath: "src/util.ts" });
  });

  it("[negative] a resolved file that is not the gold file is a mismatch", () => {
    expect(
      auditImportedTarget(input({ goldFiles: ["src/lib/impl.ts"] })),
    ).toEqual({
      kind: "mismatch",
      filePath: "src/util.ts",
    });
  });

  it("[boundary] maps .js specifiers to TypeScript sources and index files", () => {
    const exists = (file: string) => files.has(file);
    expect(resolveRelativeSpecifier("src/caller.ts", "./esm.js", exists)).toBe(
      "src/esm.ts",
    );
    expect(resolveRelativeSpecifier("src/caller.ts", "./view", exists)).toBe(
      "src/view.tsx",
    );
    expect(resolveRelativeSpecifier("src/lib/impl.ts", "..", exists)).toBe(
      undefined,
    );
    expect(resolveRelativeSpecifier("src/lib/impl.ts", "../lib", exists)).toBe(
      "src/lib/index.ts",
    );
    expect(
      resolveRelativeSpecifier("src/caller.ts", "some-package", exists),
    ).toBe(undefined);
  });

  it("[invalid-input] unsupported shapes are not-applicable, never a guess", () => {
    const na = (overrides: Partial<ImportAuditInput>) =>
      auditImportedTarget(input(overrides)).kind;
    expect(na({ calleeName: "local" })).toBe("not-applicable");
    expect(na({ calleeName: "pkg" })).toBe("not-applicable");
    expect(na({ calleeKind: "this", receiverText: "this" })).toBe(
      "not-applicable",
    );
    expect(
      na({ calleeName: "info", calleeKind: "member", receiverText: "logger" }),
    ).toBe("not-applicable");
    expect(
      na({ calleeName: "missing", calleeKind: "member", receiverText: "u" }),
    ).toBe("not-applicable");
  });

  it("[error-handling] re-export cycles stop at the depth cap", () => {
    const cyclic: Record<string, ModuleSyntax> = {
      "src/util.ts": {
        declared: [],
        classes: [],
        reexports: [{ exported: "run", imported: "run", specifier: "./util" }],
      },
    };
    expect(
      auditImportedTarget(input({ moduleOf: (file) => cyclic[file] })),
    ).toEqual({ kind: "not-applicable", reason: "export-not-found" });
  });
});
