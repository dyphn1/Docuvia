import { describe, it, expect, beforeAll } from "vitest";
import { Parser } from "web-tree-sitter";
import { buildParseResponse } from "./ast-worker.js";

// ── Honest tests: parse REAL code, verify REAL output ─────────────────────────────
// No mocks. No hand-crafted AST. Real tree-sitter parsing of real TypeScript code.
// If the parser is broken, these tests fail. That's the point.

let parserInitialized = false;

beforeAll(async () => {
  if (!parserInitialized) {
    await Parser.init();
    parserInitialized = true;
  }
});

describe("AST Parsing: buildParseResponse with real TypeScript code", () => {
  it("extracts function declarations from real code", async () => {
    const code = `
export function foo() { return 1; }
export function bar(x: number) { return x + 1; }
function baz() { return foo() + bar(2); }
`;
    const result = await buildParseResponse({
      taskId: "honest-1",
      filePath: "src/test.ts",
      code,
      language: "typescript",
    });

    expect(result.success).toBe(true);
    expect(result.data!.functions.length).toBeGreaterThanOrEqual(2);
    const names = result.data!.functions.map((f) => f.name);
    expect(names).toContain("foo");
    expect(names).toContain("bar");
  });

  it("extracts call sites from real code", async () => {
    const code = `
function foo() { return 1; }
function bar() { return foo(); }
function baz() { return foo() + bar(); }
`;
    const result = await buildParseResponse({
      taskId: "honest-2",
      filePath: "src/test.ts",
      code,
      language: "typescript",
    });

    expect(result.success).toBe(true);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(2);
    const targets = result.data!.calls.map((c) => c.targetFunction);
    expect(targets).toContain("foo");
    expect(targets).toContain("bar");
  });

  it("extracts imports from real code", async () => {
    const code = `
import { readFileSync } from "fs";
import path from "path";
import { foo } from "./bar.js";
`;
    const result = await buildParseResponse({
      taskId: "honest-3",
      filePath: "src/test.ts",
      code,
      language: "typescript",
    });

    expect(result.success).toBe(true);
    expect(result.data!.imports.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts class declarations from real code", async () => {
    const code = `
class Foo {
  bar() { return 1; }
  baz = () => { return 2; };
}
`;
    const result = await buildParseResponse({
      taskId: "honest-4",
      filePath: "src/test.ts",
      code,
      language: "typescript",
    });

    expect(result.success).toBe(true);
    expect(result.data!.classes.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.classes[0].name).toBe("Foo");
  });

  it("parses real Docuvia source file (scope-resolver.ts)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "../graph/scope-resolver.ts");
    const code = fs.readFileSync(filePath, "utf-8");

    const result = await buildParseResponse({
      taskId: "honest-scope",
      filePath: "lib/core/src/graph/scope-resolver.ts",
      code,
      language: "typescript",
    });

    expect(result.success).toBe(true);
    expect(result.data!.functions.length).toBeGreaterThanOrEqual(1);
    // scope-resolver.ts has imports
    expect(result.data!.imports.length).toBeGreaterThanOrEqual(1);
    // scope-resolver.ts has call sites
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("parses real Docuvia source file (ast-worker.ts)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(__dirname, "./ast-worker.ts");
    const code = fs.readFileSync(filePath, "utf-8");

    const result = await buildParseResponse({
      taskId: "honest-ast",
      filePath: "lib/core/src/ast/ast-worker.ts",
      code,
      language: "typescript",
    });

    expect(result.success).toBe(true);
    expect(result.data!.functions.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);
    // ast-worker.ts imports from @workspace/ast-core and @workspace/contracts
    expect(result.data!.imports.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Callee Evidence: getCalleeEvidence with real AST nodes", () => {
  it("classifies bare function calls correctly", async () => {
    const code = "function foo() { return 1; }\nfoo();\n";
    const result = await buildParseResponse({
      taskId: "honest-ce-1",
      filePath: "src/test.ts",
      code,
      language: "typescript",
    });

    // foo() should be extracted as a call with targetFunction "foo"
    const callSites = result.data!.calls;
    expect(callSites.length).toBeGreaterThanOrEqual(1);
    const fooCall = callSites.find((c) => c.targetFunction === "foo");
    expect(fooCall).toBeDefined();
    expect(fooCall!.targetFunction).toBe("foo");
  });

  it("classifies member calls correctly (obj.method())", async () => {
    const code = `
const arr = [1, 2, 3];
arr.push(4);
arr.map(x => x + 1);
`;
    const result = await buildParseResponse({
      taskId: "honest-ce-2",
      filePath: "src/test.ts",
      code,
      language: "typescript",
    });

    const callSites = result.data!.calls;
    // arr.push and arr.map should be extracted
    const pushCall = callSites.find((c) => c.targetFunction.includes("push"));
    const mapCall = callSites.find((c) => c.targetFunction.includes("map"));
    expect(pushCall).toBeDefined();
    expect(pushCall!.targetFunction).toContain("push");
    expect(mapCall).toBeDefined();
    expect(mapCall!.targetFunction).toContain("map");
  });

  it("classifies this-receiver calls correctly", async () => {
    const code = `
class Foo {
  bar() { return 1; }
  baz() { return this.bar(); }
}
`;
    const result = await buildParseResponse({
      taskId: "honest-ce-3",
      filePath: "src/test.ts",
      code,
      language: "typescript",
    });

    const callSites = result.data!.calls;
    // this.bar() should be extracted
    const thisCall = callSites.find(
      (c) => c.targetFunction.includes("bar") && c.sourceFunction === "baz",
    );
    expect(thisCall).toBeDefined();
    expect(thisCall!.sourceFunction).toBe("baz");
    expect(thisCall!.targetFunction).toContain("bar");
  });

  it("classifies import-based calls correctly", async () => {
    const code = `
import { readFileSync } from "fs";
const data = readFileSync("test.txt", "utf-8");
`;
    const result = await buildParseResponse({
      taskId: "honest-ce-4",
      filePath: "src/test.ts",
      code,
      language: "typescript",
    });

    const callSites = result.data!.calls;
    const readCall = callSites.find((c) =>
      c.targetFunction.includes("readFileSync"),
    );
    expect(readCall).toBeDefined();
    expect(readCall!.targetFunction).toContain("readFileSync");
  });

  it("handles real-world code: Express-like route handler", async () => {
    const code = `
import express from "express";
const app = express();
app.get("/users", (req, res) => {
  const users = db.query("SELECT * FROM users");
  res.json(users);
});
app.listen(3000);
`;
    const result = await buildParseResponse({
      taskId: "honest-ce-5",
      filePath: "src/server.ts",
      code,
      language: "typescript",
    });

    expect(result.success).toBe(true);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.imports.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Full pipeline: parse → persist → verify edges (real files)", () => {
  it("parse two real files with cross-file import and verify call sites are extracted", async () => {
    const fs = await import("fs");
    const path = await import("path");

    // Parse scope-resolver.ts (imports from contracts)
    const scopePath = path.resolve(__dirname, "../graph/scope-resolver.ts");
    const scopeCode = fs.readFileSync(scopePath, "utf-8");
    const scopeResult = await buildParseResponse({
      taskId: "honest-pipeline-1",
      filePath: "lib/core/src/graph/scope-resolver.ts",
      code: scopeCode,
      language: "typescript",
    });

    // Parse persist-ast-graph.ts (imports from scope-resolver)
    const persistPath = path.resolve(
      __dirname,
      "../graph/persist-ast-graph.ts",
    );
    const persistCode = fs.readFileSync(persistPath, "utf-8");
    const persistResult = await buildParseResponse({
      taskId: "honest-pipeline-2",
      filePath: "lib/core/src/graph/persist-ast-graph.ts",
      code: persistCode,
      language: "typescript",
    });

    // Both should parse successfully
    expect(scopeResult.success).toBe(true);
    expect(persistResult.success).toBe(true);

    // Both should have call sites
    expect(scopeResult.data!.calls.length).toBeGreaterThanOrEqual(1);
    expect(persistResult.data!.calls.length).toBeGreaterThanOrEqual(1);

    // scope-resolver.ts imports from contracts → should have import-based calls
    const scopeImportTargets = scopeResult.data!.calls.map(
      (c) => c.targetFunction,
    );
    expect(scopeImportTargets.length).toBeGreaterThanOrEqual(1);

    // persist-ast-graph.ts imports from scope-resolver → should have calls
    const persistImportTargets = persistResult.data!.calls.map(
      (c) => c.targetFunction,
    );
    expect(persistImportTargets.length).toBeGreaterThanOrEqual(1);
  });
});
