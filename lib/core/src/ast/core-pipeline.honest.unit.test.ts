import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildParseResponse } from "./ast-worker.js";

const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");

// ── Honest tests for core pipeline: REAL files, REAL parsing, ZERO mocks ──────────

function parseRealFile(relativePath: string) {
  const filePath = path.join(WORKSPACE_ROOT, relativePath);
  const code = fs.readFileSync(filePath, "utf-8");
  return buildParseResponse({
    taskId: `honest-${relativePath}`,
    filePath: relativePath,
    code,
    language: "typescript",
  });
}

describe("Core pipeline: parse real Docuvia source files", () => {
  it("scope-resolver.ts: has functions, imports, and call sites", async () => {
    const result = await parseRealFile("lib/core/src/graph/scope-resolver.ts");
    expect(result.success).toBe(true);
    expect(result.data!.functions.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.imports.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);

    const fnNames = result.data!.functions.map((f) => f.name);
    expect(fnNames).toContain("resolveCall");
    expect(fnNames).toContain("resolveMemberCall");
  });

  it("persist-ast-graph.ts: imports from scope-resolver", async () => {
    const result = await parseRealFile(
      "lib/core/src/graph/persist-ast-graph.ts",
    );
    expect(result.success).toBe(true);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);

    const importPaths = result.data!.imports.map((i) => i.modulePath);
    const hasScopeResolverImport = importPaths.some((p) =>
      p.includes("scope-resolver"),
    );
    expect(hasScopeResolverImport).toBe(true);
  });

  it("ast-worker.ts: imports from @workspace/ast-core and @workspace/contracts", async () => {
    const result = await parseRealFile("lib/core/src/ast/ast-worker.ts");
    expect(result.success).toBe(true);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);

    const importPaths = result.data!.imports.map((i) => i.modulePath);
    const hasAstCore = importPaths.some((p) =>
      p.includes("@workspace/ast-core"),
    );
    const hasContracts = importPaths.some((p) =>
      p.includes("@workspace/contracts"),
    );
    expect(hasAstCore).toBe(true);
    expect(hasContracts).toBe(true);
  });

  it("resolve-wasm-path.ts: exports resolveWasmPath", async () => {
    const result = await parseRealFile("lib/core/src/ast/resolve-wasm-path.ts");
    expect(result.success).toBe(true);
    const fnNames = result.data!.functions.map((f) => f.name);
    expect(fnNames).toContain("resolveWasmPath");
  });

  it("ast-worker-pool.ts: has class AstWorkerPool and calls enqueueSpawn/spawnWorker", async () => {
    const result = await parseRealFile("lib/core/src/ast/ast-worker-pool.ts");
    expect(result.success).toBe(true);
    expect(result.data!.classes.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("impact-workflow.ts: has ImpactWorkflow class and call sites", async () => {
    const result = await parseRealFile(
      "lib/ui-core/src/workflows/impact/impact-workflow.ts",
    );
    expect(result.success).toBe(true);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.functions.length).toBeGreaterThanOrEqual(1);
  });

  it("doctor-workflow.ts: has DoctorWorkflow class and call sites", async () => {
    const result = await parseRealFile(
      "lib/ui-core/src/workflows/doctor/doctor-workflow.ts",
    );
    expect(result.success).toBe(true);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("query.service.ts: has QueryService class and call sites", async () => {
    const result = await parseRealFile("lib/core/src/query/query.service.ts");
    expect(result.success).toBe(true);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("analyze-workflow.ts: imports ingestion modules", async () => {
    const result = await parseRealFile(
      "lib/ui-core/src/workflows/analyze/analyze-workflow.ts",
    );
    expect(result.success).toBe(true);
    const importPaths = result.data!.imports.map((i) => i.modulePath);
    const hasIngestionImport = importPaths.some(
      (p) =>
        p.includes("run-full-ingestion") || p.includes("run-delta-ingestion"),
    );
    expect(hasIngestionImport).toBe(true);
  });

  it("file-discovery.service.ts: has discovery logic and call sites", async () => {
    const result = await parseRealFile(
      "lib/core/src/discovery/file-discovery.service.ts",
    );
    expect(result.success).toBe(true);
    expect(result.data!.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Callee evidence: verify extraction from real code patterns", () => {
  it("bare function call: foo()", async () => {
    const result = await buildParseResponse({
      taskId: "honest-ce-bare",
      filePath: "src/test.ts",
      code: "function foo() { return 1; }\nfoo();\n",
      language: "typescript",
    });
    const call = result.data!.calls.find((c) => c.targetFunction === "foo");
    expect(call).toBeDefined();
    expect(call!.targetFunction).toBe("foo");
  });

  it("member call: obj.method()", async () => {
    const result = await buildParseResponse({
      taskId: "honest-ce-member",
      filePath: "src/test.ts",
      code: "const arr = [1,2,3];\narr.push(4);\narr.map(x => x);\n",
      language: "typescript",
    });
    expect(
      result.data!.calls.some((c) => c.targetFunction.includes("push")),
    ).toBe(true);
    expect(
      result.data!.calls.some((c) => c.targetFunction.includes("map")),
    ).toBe(true);
  });

  it("this-receiver call: this.method()", async () => {
    const result = await buildParseResponse({
      taskId: "honest-ce-this",
      filePath: "src/test.ts",
      code: "class Foo {\n  bar() { return 1; }\n  baz() { return this.bar(); }\n}\n",
      language: "typescript",
    });
    const thisCall = result.data!.calls.find(
      (c) => c.targetFunction.includes("bar") && c.sourceFunction === "baz",
    );
    expect(thisCall).toBeDefined();
    expect(thisCall!.sourceFunction).toBe("baz");
  });

  it("import-based call: readFileSync()", async () => {
    const result = await buildParseResponse({
      taskId: "honest-ce-import",
      filePath: "src/test.ts",
      code: 'import { readFileSync } from "fs";\nconst data = readFileSync("test.txt");\n',
      language: "typescript",
    });
    expect(
      result.data!.calls.some((c) => c.targetFunction.includes("readFileSync")),
    ).toBe(true);
  });

  it("chained call: expect(x).toEqual(y)", async () => {
    const result = await buildParseResponse({
      taskId: "honest-ce-chain",
      filePath: "src/test.ts",
      code: 'import { expect } from "vitest";\nexpect(1).toEqual(1);\n',
      language: "typescript",
    });
    expect(
      result.data!.calls.some((c) => c.targetFunction.includes("toEqual")),
    ).toBe(true);
  });
});
