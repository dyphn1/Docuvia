import { describe, it, expect, vi } from "vitest";
import { AstTraverser } from "../src/core/ast-traverser.js";
import { LanguageProvider } from "../src/language-provider.js";
import type { Node } from "web-tree-sitter";

describe("AstTraverser", () => {
  const createMockNode = (name?: string): Node => {
    return {
      childForFieldName: (field: string) =>
        field === "name" && name ? ({ text: name } as any) : null,
      descendantsOfType: () => (name ? [{ text: name } as any] : []),
    } as unknown as Node;
  };

  const mockProvider = {
    extractClasses: vi.fn().mockReturnValue([createMockNode("MyClass")]),
    extractFunctions: vi.fn().mockReturnValue([createMockNode("myFunction")]),
    extractImports: vi.fn().mockReturnValue([createMockNode()]),
    extractCalls: vi.fn().mockReturnValue([createMockNode()]),
  } as unknown as LanguageProvider;

  const traverser = new AstTraverser(mockProvider, {} as Node);

  it("extracts classes correctly", () => {
    const classes = traverser.extractClasses();
    expect(classes).toEqual([{ type: "class", name: "MyClass" }]);
  });

  it("extracts functions correctly", () => {
    const funcs = traverser.extractFunctions();
    expect(funcs).toEqual([{ type: "function", name: "myFunction" }]);
  });

  it("extracts imports correctly", () => {
    const imports = traverser.getImports();
    expect(imports.length).toBe(1);
  });

  it("extracts calls correctly", () => {
    const calls = traverser.getCalls();
    expect(calls.length).toBe(1);
  });

  it("handles nodes without names safely", () => {
    const badProvider = {
      extractClasses: vi.fn().mockReturnValue([createMockNode()]),
    } as unknown as LanguageProvider;
    const badTraverser = new AstTraverser(badProvider, {} as Node);

    expect(badTraverser.extractClasses()).toEqual([]);
  });
});
