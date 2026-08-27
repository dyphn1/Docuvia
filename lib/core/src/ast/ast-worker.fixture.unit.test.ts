import { describe, it, expect, beforeAll } from "vitest";
import { Parser, Language, type Node, type Tree } from "web-tree-sitter";
import {
  DefaultProvider,
  parseImportDescriptors,
  SUPPORTED_LANGUAGES,
} from "@workspace/ast-core";
import {
  typescriptConfig,
  rustConfig,
  goConfig,
  cppConfig,
} from "@workspace/ast-core";
import {
  resolveWasmPath,
  resolveCallableName,
  collectFunctionNodes,
  collectWorkerSpawns,
  buildParseResponse,
} from "./ast-worker.js";

/**
 * Real tree-sitter WASM fixture test (not mocked) proving Steps 4-6 of
 * docs/ai_plans/improve_index_coverage_vs_gitnexus.md end-to-end:
 *   - B1 (Step 4): interface/enum/type-alias are extracted as class-kind nodes.
 *   - B2 (Step 5): arrow functions / class-field arrow methods are extracted as
 *     function-kind nodes.
 *   - B3 (Step 6): their names are resolved from the enclosing binding
 *     (variable_declarator / public_field_definition), not from the first
 *     identifier found inside the function body, and truly unbound arrow
 *     functions (bare callback arguments — including ones nested inside an
 *     assigned call expression, e.g. `const results = arr.map(x => x + 1)`)
 *     fall back to "anonymous" rather than being misattributed to an
 *     unrelated outer binding.
 *
 * Reuses ast-worker.ts's own resolveWasmPath() — the same wasm-resolution logic
 * the real init/snapshot pipeline relies on — rather than duplicating it.
 */
const SRC = `
interface Foo { bar(): void }
enum Color { Red, Green }
type Alias = { x: number };
const handler = () => { doStuff(); };
export const asyncFn = async (x: number) => x + 1;
class Widget {
  onClick = () => { this.fire(); };
}
arr.map(x => x + 1);
const results = arr.map(x => x + 1);
`;

describe("typescript fixture: real tree-sitter parse (Steps 4-6)", () => {
  let rootNode: Node;

  beforeAll(async () => {
    await Parser.init();
    const { wasmPath, attemptedPaths } = resolveWasmPath(
      typescriptConfig.wasm_file,
    );
    if (!wasmPath) {
      throw new Error(
        `tree-sitter-typescript.wasm not found. Tried: ${attemptedPaths.join(", ")}`,
      );
    }
    const lang = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(SRC);
    if (!tree) throw new Error("Failed to parse fixture source");
    rootNode = tree.rootNode;
  });

  it("extracts interface/enum/type-alias as class-kind nodes, alongside class_declaration", () => {
    const provider = new DefaultProvider(typescriptConfig);
    const classNames = provider
      .extractClasses(rootNode)
      .map((n) => n.childForFieldName("name")?.text);

    expect(classNames).toContain("Foo");
    expect(classNames).toContain("Color");
    expect(classNames).toContain("Alias");
    expect(classNames).toContain("Widget");
  });

  it("extracts arrow functions and resolves their binding name, not an inner identifier", () => {
    const provider = new DefaultProvider(typescriptConfig);
    const names = provider
      .extractFunctions(rootNode)
      .map((n) => resolveCallableName(n));

    expect(names).toContain("handler");
    expect(names).toContain("asyncFn");
    expect(names).toContain("onClick");
    // The bug this fixes: naively picking the first identifier inside the body
    // would have named `handler` as "doStuff" instead.
    expect(names).not.toContain("doStuff");
  });

  it("falls back to 'anonymous' for a truly unbound arrow function (bare callback argument)", () => {
    const provider = new DefaultProvider(typescriptConfig);
    const names = provider
      .extractFunctions(rootNode)
      .map((n) => resolveCallableName(n));

    expect(names).toContain("anonymous");
  });

  it("regression: does not misattribute the outer variable's name to an arrow function passed as a call argument (const results = arr.map(x => x + 1))", () => {
    const provider = new DefaultProvider(typescriptConfig);
    const names = provider
      .extractFunctions(rootNode)
      .map((n) => resolveCallableName(n));

    // The callback `x => x + 1` is an argument to `.map()`, not the direct value bound
    // to `results` — walking up must stop at the `arguments` node boundary and return
    // "anonymous", not climb past it to the outer `variable_declarator` and return "results".
    expect(names).not.toContain("results");
    expect(names).toContain("anonymous");
  });
});

/**
 * Regression test for the import-resolution bug fixed in
 * docs/ai_plans/fix_import_resolution_export_topology_query.md: ast-worker.ts used to push
 * `{ localName: node.text, originalName: node.text, modulePath: "" }` for every import — i.e.
 * the ENTIRE raw import statement text, not a parsed identifier — which meant
 * ScopeResolver.resolveCall()'s import-matching branch (`imp.localName === callName`) could
 * never match any cross-file call, in the real init/snapshot pipeline. This asserts
 * ast-worker.ts now produces a real, parsed ImportDescriptor via
 * @workspace/ast-core's parseImportDescriptors() instead.
 */
const IMPORT_SRC = `
import { helper } from "./b";
function main() { helper(); }
`;

describe("typescript fixture: import resolution regression (cross-file calls)", () => {
  let importRootNode: Node;

  beforeAll(async () => {
    await Parser.init();
    const { wasmPath, attemptedPaths } = resolveWasmPath(
      typescriptConfig.wasm_file,
    );
    if (!wasmPath) {
      throw new Error(
        `tree-sitter-typescript.wasm not found. Tried: ${attemptedPaths.join(", ")}`,
      );
    }
    const lang = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(IMPORT_SRC);
    if (!tree) throw new Error("Failed to parse import fixture source");
    importRootNode = tree.rootNode;
  });

  it("produces a real parsed ImportDescriptor {localName, originalName, modulePath}, not the raw statement text", () => {
    const provider = new DefaultProvider(typescriptConfig);
    const importNodes = provider.extractImports(importRootNode);
    const descriptors = parseImportDescriptors(importNodes);

    expect(descriptors).toContainEqual({
      localName: "helper",
      originalName: "helper",
      modulePath: "./b",
    });

    // The bug this fixes: the old code pushed the entire raw statement text as localName.
    for (const d of descriptors) {
      expect(d.localName).not.toContain("import");
      expect(d.localName).not.toContain(";");
    }
  });
});

/**
 * GRPH-006 (Step 2): `collectFunctionNodes` must resolve each function's enclosing class via
 * `classNodes`, and must convert `findEnclosingContainerName`'s "anonymous" sentinel to `undefined`
 * for a top-level function rather than storing the literal string (which would otherwise qualify
 * every top-level function's node_key as `file#anonymous.name` -- a regression, not a fix).
 */
const CONTAINER_SRC = `
class Widget {
  bar() { doStuff(); }
}
function topLevel() {}
`;

describe("typescript fixture: containerName (GRPH-006 Step 2)", () => {
  let tree: Tree;

  beforeAll(async () => {
    await Parser.init();
    const { wasmPath, attemptedPaths } = resolveWasmPath(
      typescriptConfig.wasm_file,
    );
    if (!wasmPath) {
      throw new Error(
        `tree-sitter-typescript.wasm not found. Tried: ${attemptedPaths.join(", ")}`,
      );
    }
    const lang = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    const parsed = parser.parse(CONTAINER_SRC);
    if (!parsed) throw new Error("Failed to parse fixture source");
    tree = parsed;
  });

  it("qualifies a method's containerName with its enclosing class, and leaves a top-level function's containerName undefined", () => {
    const provider = new DefaultProvider(typescriptConfig);
    const classNodes = provider.extractClasses(tree.rootNode);
    const functions: Parameters<typeof collectFunctionNodes>[2] = [];

    collectFunctionNodes(tree, provider, functions, classNodes);

    expect(functions.find((f) => f.name === "bar")?.containerName).toBe(
      "Widget",
    );
    expect(
      functions.find((f) => f.name === "topLevel")?.containerName,
    ).toBeUndefined();
  });
});

/**
 * GRPH-006 follow-up (Rust): `impl_item` is deliberately excluded from `rustConfig.classes`
 * (see rust-lsp-edge-provider.unit.test.ts), so the generic ancestor walk always returns
 * "anonymous" for a Rust method -- `resolveRustImplContainerName` reads the impl block's own
 * `type` field instead. Asserts both a plain `impl Struct` and confirms a top-level `fn` is
 * unaffected.
 */
const RUST_CONTAINER_SRC = `
struct Greeter;

impl Greeter {
    fn hello(&self) {}
}

fn topLevel() {}
`;

describe("rust fixture: containerName (GRPH-006 follow-up)", () => {
  let tree: Tree;

  beforeAll(async () => {
    await Parser.init();
    const { wasmPath, attemptedPaths } = resolveWasmPath(rustConfig.wasm_file);
    if (!wasmPath) {
      throw new Error(
        `tree-sitter-rust.wasm not found. Tried: ${attemptedPaths.join(", ")}`,
      );
    }
    const lang = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    const parsed = parser.parse(RUST_CONTAINER_SRC);
    if (!parsed) throw new Error("Failed to parse fixture source");
    tree = parsed;
  });

  it("qualifies an impl-block method's containerName with the impl's target type, and leaves a top-level fn's containerName undefined", () => {
    const provider = new DefaultProvider(rustConfig);
    const classNodes = provider.extractClasses(tree.rootNode);
    const functions: Parameters<typeof collectFunctionNodes>[2] = [];

    collectFunctionNodes(tree, provider, functions, classNodes);

    expect(functions.find((f) => f.name === "hello")?.containerName).toBe(
      "Greeter",
    );
    expect(
      functions.find((f) => f.name === "topLevel")?.containerName,
    ).toBeUndefined();
  });
});

/**
 * GRPH-006 follow-up (Go): a `method_declaration`'s receiver type is never an AST ancestor
 * (`type_declaration` never encloses it), so the generic ancestor walk always returns "anonymous"
 * here too -- `resolveGoReceiverContainerName` reads the receiver parameter's own `type` field
 * instead, unwrapping `pointer_type` for a pointer receiver.
 */
const GO_CONTAINER_SRC = `
package main

type Receiver struct{}

func (r Receiver) ValueMethod() {}

func (r *Receiver) PointerMethod() {}

func topLevel() {}
`;

describe("go fixture: containerName (GRPH-006 follow-up)", () => {
  let tree: Tree;

  beforeAll(async () => {
    await Parser.init();
    const { wasmPath, attemptedPaths } = resolveWasmPath(goConfig.wasm_file);
    if (!wasmPath) {
      throw new Error(
        `tree-sitter-go.wasm not found. Tried: ${attemptedPaths.join(", ")}`,
      );
    }
    const lang = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    const parsed = parser.parse(GO_CONTAINER_SRC);
    if (!parsed) throw new Error("Failed to parse fixture source");
    tree = parsed;
  });

  it("qualifies both a value-receiver and a pointer-receiver method with the receiver's type name, and leaves a plain func's containerName undefined", () => {
    const provider = new DefaultProvider(goConfig);
    const classNodes = provider.extractClasses(tree.rootNode);
    const functions: Parameters<typeof collectFunctionNodes>[2] = [];

    collectFunctionNodes(tree, provider, functions, classNodes);

    expect(functions.find((f) => f.name === "ValueMethod")?.containerName).toBe(
      "Receiver",
    );
    expect(
      functions.find((f) => f.name === "PointerMethod")?.containerName,
    ).toBe("Receiver");
    expect(
      functions.find((f) => f.name === "topLevel")?.containerName,
    ).toBeUndefined();
  });
});

/**
 * GRPH-006 follow-up (C++): inline methods are lexically nested in `class_specifier` and now
 * resolve via the generic ancestor walk once they're actually extracted as functions (see
 * `cpp.ts`'s functions-query fix -- previously `field_identifier`/`qualified_identifier`
 * declarators weren't captured at all). Out-of-line `Ret Class::method(){}` definitions are never
 * nested, so `resolveCppQualifiedContainerName` reads the qualified declarator's own `scope`
 * field instead.
 */
const CPP_CONTAINER_SRC = `
class Foo {
  void inlineMethod() {}
  void outOfLineMethod();
};

void Foo::outOfLineMethod() {}

void freeFunction() {}
`;

describe("cpp fixture: containerName (GRPH-006 follow-up)", () => {
  let tree: Tree;
  let lang: Language;

  beforeAll(async () => {
    await Parser.init();
    const { wasmPath, attemptedPaths } = resolveWasmPath(cppConfig.wasm_file);
    if (!wasmPath) {
      throw new Error(
        `tree-sitter-cpp.wasm not found. Tried: ${attemptedPaths.join(", ")}`,
      );
    }
    lang = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    const parsed = parser.parse(CPP_CONTAINER_SRC);
    if (!parsed) throw new Error("Failed to parse fixture source");
    tree = parsed;
  });

  it("qualifies both an inline method and an out-of-line qualified definition with the class name, and leaves a free function's containerName undefined", () => {
    const provider = new DefaultProvider(cppConfig);
    // The functions-query fix (identifier | field_identifier | qualified_identifier) only takes
    // effect once queries are compiled -- extractFunctions falls back to an uncompiled
    // descendantsOfType(FUNCTION_DEFINITION) otherwise, which would also work here but wouldn't
    // exercise the actual fixed query this test is meant to cover.
    provider.initQueries?.(lang);
    const classNodes = provider.extractClasses(tree.rootNode);
    const functions: Parameters<typeof collectFunctionNodes>[2] = [];

    collectFunctionNodes(tree, provider, functions, classNodes);

    expect(
      functions.find((f) => f.name === "inlineMethod")?.containerName,
    ).toBe("Foo");
    expect(
      functions.find((f) => f.name === "outOfLineMethod")?.containerName,
    ).toBe("Foo");
    expect(
      functions.find((f) => f.name === "freeFunction")?.containerName,
    ).toBeUndefined();
  });
});

/**
 * Regression test for the `new Worker(...)` worker_threads dependency-edge false negative
 * (docuvia-self dogfooding bug: `docuvia impact "lib/core/src/ast/ast-worker.ts"` reported "No
 * dependents found" even though `ast-worker-pool.ts` genuinely spawns it via
 * `new Worker(this.wPath, this.workerOptions)`, with `this.wPath` set earlier by
 * `this.wPath = path.resolve(__dirname, "./ast-worker.js")`). Mimics that exact real-world shape.
 */
const WORKER_SPAWN_SRC = `
class AstWorkerPool {
  wPath = "";
  initialize() {
    this.wPath = path.resolve(__dirname, "./ast-worker.js");
  }
  spawnWorker() {
    const worker = new Worker(this.wPath, this.workerOptions);
  }
}
`;

describe("typescript fixture: new Worker(...) spawn detection (worker_threads dependency edge)", () => {
  let tree: Tree;

  beforeAll(async () => {
    await Parser.init();
    const { wasmPath, attemptedPaths } = resolveWasmPath(
      typescriptConfig.wasm_file,
    );
    if (!wasmPath) {
      throw new Error(
        `tree-sitter-typescript.wasm not found. Tried: ${attemptedPaths.join(", ")}`,
      );
    }
    const lang = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    const parsed = parser.parse(WORKER_SPAWN_SRC);
    if (!parsed) throw new Error("Failed to parse fixture source");
    tree = parsed;
  });

  it('resolves `this.wPath = path.resolve(__dirname, "./ast-worker.js")` through to the `new Worker(this.wPath, ...)` call site, attributed to its enclosing function', () => {
    const provider = new DefaultProvider(typescriptConfig);
    const classNodes = provider.extractClasses(tree.rootNode);
    const functions: Parameters<typeof collectFunctionNodes>[2] = [];
    const functionNodes = collectFunctionNodes(
      tree,
      provider,
      functions,
      classNodes,
    );

    const workerSpawns: Parameters<typeof collectWorkerSpawns>[3] = [];
    collectWorkerSpawns(
      tree,
      SUPPORTED_LANGUAGES.TYPESCRIPT,
      functionNodes,
      workerSpawns,
    );

    expect(workerSpawns).toContainEqual({
      sourceFunction: "spawnWorker",
      targetPath: "./ast-worker.js",
    });
  });

  it("does not detect a spawn for a non-TS/JS language, even given the identical grammar shape", () => {
    const provider = new DefaultProvider(typescriptConfig);
    const classNodes = provider.extractClasses(tree.rootNode);
    const functions: Parameters<typeof collectFunctionNodes>[2] = [];
    const functionNodes = collectFunctionNodes(
      tree,
      provider,
      functions,
      classNodes,
    );

    const workerSpawns: Parameters<typeof collectWorkerSpawns>[3] = [];
    collectWorkerSpawns(
      tree,
      SUPPORTED_LANGUAGES.CSHARP,
      functionNodes,
      workerSpawns,
    );

    expect(workerSpawns).toEqual([]);
  });
});

/**
 * Regression test for docs/ai_plans/implement_typescript-abstract-class-extraction.md:
 * `abstract class` parses as its own distinct `abstract_class_declaration` grammar node (not a
 * modifier flag on `class_declaration`), so it was never enumerated in either `typescriptConfig`'s
 * `classes` fallback array or its compiled `queries.classes` string -- every `export abstract
 * class Foo { ... }` in any TS/TSX file was silently missing from the knowledge graph entirely.
 * Calls `provider.initQueries(lang)` (mirroring ast-worker.ts's real parseAndExtract() path) so
 * this exercises the compiled query, not just the descendantsOfType fallback.
 */
const ABSTRACT_CLASS_SRC = `
export abstract class Foo implements Bar { baz() {} }
export class Plain {}
`;

describe("typescript fixture: abstract class declaration extraction", () => {
  let root: Node;
  let provider: DefaultProvider;

  beforeAll(async () => {
    await Parser.init();
    const { wasmPath, attemptedPaths } = resolveWasmPath(
      typescriptConfig.wasm_file,
    );
    if (!wasmPath) {
      throw new Error(
        `tree-sitter-typescript.wasm not found. Tried: ${attemptedPaths.join(", ")}`,
      );
    }
    const lang = await Language.load(wasmPath);
    provider = new DefaultProvider(typescriptConfig);
    provider.initQueries(lang);
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(ABSTRACT_CLASS_SRC);
    if (!tree) throw new Error("Failed to parse fixture source");
    root = tree.rootNode;
  });

  it("extracts `export abstract class Foo` as a class-kind node named Foo, not just its method", () => {
    const classNames = provider
      .extractClasses(root)
      .map((n) => n.childForFieldName("name")?.text);

    expect(classNames).toContain("Foo");
    expect(classNames).not.toContain("baz");
  });

  it("still extracts a plain `export class` alongside the abstract one (no regression)", () => {
    const classNames = provider
      .extractClasses(root)
      .map((n) => n.childForFieldName("name")?.text);

    expect(classNames).toContain("Plain");
  });
});

/**
 * Regression test for Finding C (issue #11 plan A, Slice 3): a member/field call's seeded
 * `startLine`/`startColumn` must land on the callee identifier (`doSomething`), not the
 * receiver (`service`) -- the `calls` tree-sitter query captures the whole `member_expression`,
 * whose own `startPosition` is the receiver's. Uses a real `buildParseResponse()` call (same
 * pattern as `persist-ast-graph.unit.test.ts`'s Go fixture), not a hand-built tree-sitter node.
 */
const CALL_POSITION_SRC = `function main() {
  foo();
  service.doSomething();
}
`;

describe("typescript fixture: call-site position (issue #11 plan A, Finding C)", () => {
  it("seeds a bare call's position on the callee identifier itself", async () => {
    const response = await buildParseResponse({
      taskId: "call-position-bare",
      filePath: "call-position.ts",
      code: CALL_POSITION_SRC,
      language: "typescript",
    });

    const bareCall = response.data!.calls.find(
      (c) => c.targetFunction === "foo",
    );
    expect(bareCall).toBeDefined();
    // `foo()` is on line 1 (0-based) -- "  foo();" -- callee starts at column 2.
    expect(bareCall!.startLine).toBe(1);
    expect(bareCall!.startColumn).toBe(2);
  });

  it("seeds a member call's position on the callee (doSomething), not the receiver (service)", async () => {
    const response = await buildParseResponse({
      taskId: "call-position-member",
      filePath: "call-position.ts",
      code: CALL_POSITION_SRC,
      language: "typescript",
    });

    const memberCall = response.data!.calls.find((c) =>
      c.targetFunction.includes("doSomething"),
    );
    expect(memberCall).toBeDefined();
    // "  service.doSomething();" -- "service." is 8 chars, so the callee ("doSomething")
    // starts at column 10 on line 2 (0-based). The receiver ("service") starts at column 2 --
    // asserting column 10 (not 2) is the actual regression check.
    expect(memberCall!.startLine).toBe(2);
    expect(memberCall!.startColumn).toBe(10);
  });
});

// ── Issue #192 gaps 1+2: exported consts + barrel re-exports ──────────────

const CONST_AND_BARREL_SRC = `
export const EVAL_MAX_RETRIES = 3;
const localTemp = "not-exported";
export const lazyHandler = () => { localTemp.length; };
export { evalChainHelper } from "../deep/util";
export { origThing as outwardThing } from "../deep/other";
`;

describe("typescript fixture: exported consts and barrel re-exports (issue #192)", () => {
  it("indexes an exported scalar const as a variable symbol, but not a non-exported one", async () => {
    const response = await buildParseResponse({
      taskId: "const-indexing",
      filePath: "consts.ts",
      code: CONST_AND_BARREL_SRC,
      language: "typescript",
    });

    const names = (response.data!.variables ?? []).map((v) => v.name);
    expect(names).toContain("EVAL_MAX_RETRIES");
    expect(names).not.toContain("localTemp");
  });

  it("does not double-index function-valued const initializers (already functions)", async () => {
    const response = await buildParseResponse({
      taskId: "const-arrow-exclusion",
      filePath: "consts.ts",
      code: CONST_AND_BARREL_SRC,
      language: "typescript",
    });

    const names = (response.data!.variables ?? []).map((v) => v.name);
    expect(names).not.toContain("lazyHandler");
  });

  it("emits viaReexport import descriptors for export...from statements", async () => {
    const response = await buildParseResponse({
      taskId: "barrel-descriptors",
      filePath: "mid/index.ts",
      code: `export { evalChainHelper } from "../deep/util";\nexport { origThing as outwardThing } from "../deep/other";\n`,
      language: "typescript",
    });

    expect(response.data!.imports).toEqual([
      {
        localName: "evalChainHelper",
        originalName: "evalChainHelper",
        modulePath: "../deep/util",
        viaReexport: true,
      },
      {
        localName: "outwardThing",
        originalName: "origThing",
        modulePath: "../deep/other",
        viaReexport: true,
      },
    ]);
  });
});

// ── Issue #192 root-cause fix: callee evidence decomposition ──────────────

const CALLEE_EVIDENCE_SRC = `function main() {
  foo();
  service.doSomething();
  this.refresh();
  expect(result).toEqual(3);
  obj[expr]();
}
const multi = vi
  .fn();
`;

describe("typescript fixture: callee evidence decomposition (issue #192)", () => {
  let calls: Array<Record<string, unknown>>;

  beforeAll(async () => {
    const response = await buildParseResponse({
      taskId: "callee-evidence",
      filePath: "callee-evidence.ts",
      code: CALLEE_EVIDENCE_SRC,
      language: "typescript",
    });
    calls = response.data!.calls as unknown as Array<Record<string, unknown>>;
  });

  it("classifies a bare identifier call", () => {
    const bare = calls.find((c) => c.calleeKind === "bare");
    expect(bare).toMatchObject({ calleeName: "foo" });
    expect(bare!.receiverText).toBeUndefined();
  });

  it("decomposes a member call into calleeName + receiverText", () => {
    const member = calls.find((c) => c.calleeName === "doSomething");
    expect(member).toBeDefined();
    expect(member).toMatchObject({
      receiverText: "service",
      calleeKind: "member",
      targetFunction: "service.doSomething",
    });
  });

  it("classifies a this-receiver call", () => {
    expect(calls).toContainEqual(
      expect.objectContaining({
        calleeName: "refresh",
        receiverText: "this",
        calleeKind: "this",
      }),
    );
  });

  it("classifies an invocation-result receiver as arg-chain (excluded from resolution denominators)", () => {
    expect(calls).toContainEqual(
      expect.objectContaining({
        calleeName: "toEqual",
        calleeKind: "arg-chain",
      }),
    );
  });

  it("normalizes a multi-line member chain's raw text and still decomposes the callee", () => {
    const multi = calls.find((c) => c.calleeName === "fn");
    expect(multi).toBeDefined();
    expect(multi).toMatchObject({
      targetFunction: "vi.fn",
      receiverText: "vi",
      calleeKind: "member",
    });
  });
});
