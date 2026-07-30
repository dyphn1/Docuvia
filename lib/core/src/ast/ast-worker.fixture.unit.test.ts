import { describe, it, expect, beforeAll } from "vitest";
import { Parser, Language, type Node, type Tree } from "web-tree-sitter";
import { DefaultProvider, parseImportDescriptors } from "@workspace/ast-core";
import {
  typescriptConfig,
  rustConfig,
  goConfig,
  cppConfig,
} from "@workspace/plugins-ast";
import {
  resolveWasmPath,
  resolveCallableName,
  collectFunctionNodes,
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
