import { describe, it, expect, vi, beforeEach } from "vitest";
import { initParser, generateAst } from "../src/parser-core.js";
import { Parser, Language } from "web-tree-sitter";
import { LanguageRegistry } from "../src/language-registry.js";
import { DefaultProvider } from "../src/language-provider.js";
import { AstTraverser } from "../src/core/ast-traverser.js";
import { EdgeComputer } from "../src/core/edge-computer.js";

vi.mock("web-tree-sitter", () => {
  const MockParser = vi.fn();
  MockParser.prototype.setLanguage = vi.fn();
  MockParser.prototype.parse = vi.fn();
  MockParser.prototype.delete = vi.fn();

  return {
    Parser: Object.assign(MockParser, {
      init: vi.fn().mockResolvedValue(undefined),
    }),
    Language: {
      load: vi.fn().mockResolvedValue({}),
    },
  };
});

vi.mock("../src/core/ast-traverser.js", () => {
  return {
    AstTraverser: vi.fn().mockImplementation(() => ({
      getImports: vi.fn().mockReturnValue([]),
      getCalls: vi.fn().mockReturnValue([]),
      extractClasses: vi
        .fn()
        .mockReturnValue([{ type: "node", path: "test.ts" }]),
      extractFunctions: vi.fn().mockReturnValue([]),
    })),
  };
});

vi.mock("../src/core/edge-computer.js", () => {
  return {
    EdgeComputer: vi.fn().mockImplementation(() => ({
      computeCallEdges: vi.fn().mockReturnValue([{ type: "edge" }]),
    })),
  };
});

describe("parser-core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initParser initializes Parser", async () => {
    const locateFile = (p: string) => p;
    await initParser(locateFile);
    expect(Parser.init).toHaveBeenCalledWith({ locateFile });
  });

  it("generateAst throws if no language provider is found", async () => {
    const registry = new LanguageRegistry();
    const loadWasm = vi.fn();

    const generator = generateAst(
      "content",
      "test.txt",
      ".unknown",
      registry,
      loadWasm,
    );
    await expect(async () => {
      for await (const _ of generator) {
      }
    }).rejects.toThrow("No language provider found for extension: .unknown");
  });

  it("generateAst yields events on successful parse", async () => {
    const registry = new LanguageRegistry();
    const provider = new DefaultProvider({
      extensions: [".ts"],
      wasm_file: "test.wasm",
    });
    vi.spyOn(provider, "initQueries").mockImplementation(() => {});
    vi.spyOn(provider, "deleteQueries").mockImplementation(() => {});
    registry.registerProvider([".ts"], provider);

    const loadWasm = vi.fn().mockResolvedValue("test.wasm");

    // Mock the parse method to return a dummy tree
    const tree = {
      rootNode: {
        type: "program",
        namedChildren: [{ type: "class_declaration" }],
      },
      delete: vi.fn(),
    };
    const parseMock = vi.fn().mockReturnValue(tree);
    (Parser as any).prototype.parse = parseMock;

    const generator = generateAst(
      "content",
      "test.ts",
      ".ts",
      registry,
      loadWasm,
    );
    const events = [];
    for await (const event of generator) {
      events.push(event);
    }

    expect(loadWasm).toHaveBeenCalledWith("test.wasm");
    expect(Language.load).toHaveBeenCalledWith("test.wasm");
    expect(parseMock).toHaveBeenCalledWith("content");
    expect(provider.initQueries).toHaveBeenCalled();
    expect(provider.deleteQueries).toHaveBeenCalled();
    expect(tree.delete).toHaveBeenCalled();

    expect(tree.rootNode.type).toBe("program");
    expect(tree.rootNode.namedChildren).toHaveLength(1);
    expect(tree.rootNode.namedChildren[0].type).toBe("class_declaration");

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "file", path: "test.ts" });
    expect(events[1]).toEqual({ type: "node", path: "test.ts" });
    expect(events[2]).toEqual({ type: "edge" });
  });

  it("generateAst handles Uint8Array loadWasm and TextDecoder", async () => {
    const registry = new LanguageRegistry();
    const provider = new DefaultProvider({
      extensions: [".ts"],
      wasm_file: "test.wasm",
    });
    registry.registerProvider([".ts"], provider);

    const wasmBytes = new Uint8Array([1, 2, 3]);
    const loadWasm = vi.fn().mockResolvedValue(wasmBytes);

    const tree = {
      rootNode: { type: "program", namedChildren: [] },
      delete: vi.fn(),
    };
    const parseMock = vi.fn().mockReturnValue(tree);
    (Parser as any).prototype.parse = parseMock;

    const fileContent = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    const generator = generateAst(
      fileContent,
      "test.ts",
      ".ts",
      registry,
      loadWasm,
    );
    const events = [];
    for await (const event of generator) {
      events.push(event);
    }

    expect(Language.load).toHaveBeenCalledWith(wasmBytes);
    expect(parseMock).toHaveBeenCalledWith("hello");

    expect(tree.rootNode.type).toBe("program");
    expect(tree.rootNode.namedChildren).toEqual([]);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "file", path: "test.ts" });
    expect(events[1]).toEqual({ type: "node", path: "test.ts" });
    expect(events[2]).toEqual({ type: "edge" });
  });

  it("generateAst throws if loadWasm fails", async () => {
    const registry = new LanguageRegistry();
    const provider = new DefaultProvider({
      extensions: [".ts"],
      wasm_file: "test.wasm",
    });
    registry.registerProvider([".ts"], provider);

    const loadWasm = vi.fn().mockRejectedValue(new Error("Network error"));

    const generator = generateAst(
      "content",
      "test.ts",
      ".ts",
      registry,
      loadWasm,
    );

    await expect(async () => {
      for await (const _ of generator) {
        // no-op
      }
    }).rejects.toThrow("Failed to load grammar WASM test.wasm: Network error");
  });

  it("generateAst throws if parse returns null", async () => {
    const registry = new LanguageRegistry();
    const provider = new DefaultProvider({
      extensions: [".ts"],
      wasm_file: "test.wasm",
    });
    registry.registerProvider([".ts"], provider);

    const loadWasm = vi.fn().mockResolvedValue("test.wasm");
    const deleteMock = vi.fn();
    (Parser as any).prototype.delete = deleteMock;
    (Parser as any).prototype.parse = vi.fn().mockReturnValue(null);

    const generator = generateAst(
      "content",
      "test.ts",
      ".ts",
      registry,
      loadWasm,
    );

    await expect(async () => {
      for await (const _ of generator) {
      }
    }).rejects.toThrow("Failed to parse file with tree-sitter");

    expect(deleteMock).toHaveBeenCalled();
  });
});
