import { describe, it, expect, beforeAll } from "vitest";
import { Parser, Language, type Node } from "web-tree-sitter";
import { DefaultProvider } from "@workspace/ast-core";
import type { LanguageConfig } from "@workspace/ast-core";
import {
  csharpConfig,
  javaConfig,
  javascriptConfig,
  pythonConfig,
  cppConfig,
  phpConfig,
  rubyConfig,
} from "@workspace/plugins-ast";
import { resolveWasmPath } from "./ast-worker.js";

/**
 * Real tree-sitter WASM fixture test proving the fix for IMPT-001's "blast radius shallow for
 * foundational base types" finding (docs/cli-test-analysis/csharp-cli-benchmark.md, 2026-07-24):
 * inheritance/interface-implementation edges were never extracted for any language except
 * TypeScript, so `getIncomingEdges()` on a base class like `PSCmdlet` or `IGrain` could only ever
 * surface direct `calls` references, not subclasses — a single-hop query starved of the one edge
 * type that actually answers "what breaks if I change this base type". Each block below parses
 * real source through the language's actual shipped `LanguageConfig` and asserts the resulting
 * `extractExtends`/`extractImplements` edges resolve to the expected base type/interface names.
 */
/** Mirrors ast-worker.ts's real parseAndExtract() path: compiles the provider's queries
 *  against the loaded grammar before parsing, instead of only exercising the descendantsOfType
 *  fallback — the two paths can disagree (see IMPT-001's Query API fix). */
async function loadRoot(
  config: LanguageConfig,
  provider: DefaultProvider,
  src: string,
): Promise<Node> {
  const { wasmPath, attemptedPaths } = resolveWasmPath(config.wasm_file);
  if (!wasmPath) {
    throw new Error(
      `${config.wasm_file} not found. Tried: ${attemptedPaths.join(", ")}`,
    );
  }
  const lang = await Language.load(wasmPath);
  provider.initQueries(lang);
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(src);
  if (!tree) throw new Error("Failed to parse fixture source");
  return tree.rootNode;
}

beforeAll(async () => {
  await Parser.init();
});

describe("csharp fixture: base_list edges (class + interface share one slot)", () => {
  const SRC = `
public class PSCmdlet {}
public interface IDisposable {}
public class GetCommand : PSCmdlet, IDisposable {}
`;
  it("extracts both the base class and interfaces as extends edges", async () => {
    const provider = new DefaultProvider(csharpConfig);
    const root = await loadRoot(csharpConfig, provider, SRC);
    const targets = provider.extractExtends(root).map((n) => n.text);
    expect(targets).toContain("PSCmdlet");
    expect(targets).toContain("IDisposable");
  });
});

describe("java fixture: distinct superclass/super_interfaces edges", () => {
  const SRC = `
public class Base {}
interface IFoo {}
public class Derived extends Base implements IFoo {}
`;
  it("extracts extends and implements separately", async () => {
    const provider = new DefaultProvider(javaConfig);
    const root = await loadRoot(javaConfig, provider, SRC);
    expect(provider.extractExtends(root).map((n) => n.text)).toContain("Base");
    expect(provider.extractImplements(root).map((n) => n.text)).toContain(
      "IFoo",
    );
  });
});

describe("javascript fixture: class_heritage without a distinct extends_clause node", () => {
  const SRC = `
class Base {}
class Derived extends Base {}
`;
  it("extracts the extends target", async () => {
    const provider = new DefaultProvider(javascriptConfig);
    const root = await loadRoot(javascriptConfig, provider, SRC);
    expect(provider.extractExtends(root).map((n) => n.text)).toContain("Base");
  });
});

describe("python fixture: base classes in the class_definition argument_list", () => {
  const SRC = `
class Base: pass
class Mixin: pass
class Derived(Base, Mixin, metaclass=type): pass
`;
  it("extracts bare base classes but not keyword_argument entries", async () => {
    const provider = new DefaultProvider(pythonConfig);
    const root = await loadRoot(pythonConfig, provider, SRC);
    const targets = provider.extractExtends(root).map((n) => n.text);
    expect(targets).toContain("Base");
    expect(targets).toContain("Mixin");
    expect(targets).not.toContain("metaclass=type");
  });
});

describe("cpp fixture: base_class_clause", () => {
  const SRC = `
class Base {};
class IFoo {};
class Derived : public Base, public IFoo {};
`;
  it("extracts all base_class_clause entries", async () => {
    const provider = new DefaultProvider(cppConfig);
    const root = await loadRoot(cppConfig, provider, SRC);
    const targets = provider.extractExtends(root).map((n) => n.text);
    expect(targets).toContain("Base");
    expect(targets).toContain("IFoo");
  });
});

describe("php fixture: distinct base_clause/class_interface_clause edges", () => {
  const SRC = `<?php
class Base {}
interface IFoo {}
class Derived extends Base implements IFoo {}
`;
  it("extracts extends and implements separately", async () => {
    const provider = new DefaultProvider(phpConfig);
    const root = await loadRoot(phpConfig, provider, SRC);
    expect(provider.extractExtends(root).map((n) => n.text)).toContain("Base");
    expect(provider.extractImplements(root).map((n) => n.text)).toContain(
      "IFoo",
    );
  });
});

describe("ruby fixture: superclass clause", () => {
  const SRC = `
class Base
end
class Derived < Base
end
`;
  it("extracts the superclass target", async () => {
    const provider = new DefaultProvider(rubyConfig);
    const root = await loadRoot(rubyConfig, provider, SRC);
    expect(provider.extractExtends(root).map((n) => n.text)).toContain("Base");
  });
});
