import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLogger } from "@workspace/contracts";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { RustLspEdgeProvider } from "./rust-lsp-edge-provider.js";
import { LspMethods, LspSymbolKinds } from "./lsp-constants.js";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";

type RequestHandler = (method: string, params: any) => unknown;

class FakeLspClient {
  public notifications: { method: string; params: unknown }[] = [];
  public started = false;
  public stopped = false;
  public startError: Error | undefined;

  constructor(private readonly handler: RequestHandler = () => undefined) {}

  async start(): Promise<void> {
    if (this.startError) throw this.startError;
    this.started = true;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    return this.handler(method, params) as T;
  }

  notify(method: string, params: unknown): void {
    this.notifications.push({ method, params });
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

function asClient(fake: FakeLspClient): LspJsonRpcClient {
  return fake as unknown as LspJsonRpcClient;
}

/** Unit tests fake the server, so the provider's real cold-start settle (rust-analyzer needs ~8s
 *  to load its crate graph before `references` answers non-empty -- see `rust-lsp-edge-provider
 *  .ts`'s `coldStartSettleMs`) must be disabled here, or every fake-client test would sleep 8s. */
function makeRustProvider(
  fake: FakeLspClient,
  logger = createMockLogger(),
): RustLspEdgeProvider {
  const provider = new RustLspEdgeProvider(logger, () => asClient(fake));
  provider.configure({ coldStartSettleMs: 0 });
  return provider;
}

function makeWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-rustlsp-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, relPath), content, "utf8");
  }
  return dir;
}

function uriFor(workspaceRoot: string, relPath: string): string {
  return pathToFileURL(path.join(workspaceRoot, relPath)).toString();
}

const range = (
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
) => ({
  start: { line: startLine, character: startChar },
  end: { line: endLine, character: endChar },
});

describe("RustLspEdgeProvider.resolveEdges()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeWorkspace({
      "main.rs": "fn main() {}\n",
    });
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns an empty outcome without touching the client factory when files is empty", async () => {
    const clientFactory = vi.fn();
    const provider = new RustLspEdgeProvider(createMockLogger(), clientFactory);

    const outcome = await provider.resolveEdges({ workspaceRoot, files: [] });

    expect(outcome).toEqual({ edges: [], filesProcessed: [], filesFailed: [] });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("stays on the reverse path (references) even when handed a populated callsByFile -- the provider's own definitionResolution config gates the branch, not data presence (issue #11 plan A, FWD-004/D2)", async () => {
    const methodsCalled: string[] = [];
    const handler: RequestHandler = (method) => {
      methodsCalled.push(method);
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        return [
          {
            name: "main",
            kind: LspSymbolKinds.FUNCTION,
            range: range(0, 0, 0, 13),
            selectionRange: range(0, 3, 0, 7),
          },
        ];
      }
      if (method === LspMethods.REFERENCES) return [];
      if (method === LspMethods.DEFINITION) {
        return {
          uri: uriFor(workspaceRoot, "main.rs"),
          range: range(0, 3, 0, 7),
        };
      }
      return undefined;
    };
    const fake = new FakeLspClient(handler);
    const provider = makeRustProvider(fake);

    await provider.resolveEdges({
      workspaceRoot,
      files: ["main.rs"],
      callsByFile: {
        "main.rs": [{ targetFunction: "main", startLine: 0, startColumn: 3 }],
      },
    });

    expect(methodsCalled).toContain(LspMethods.REFERENCES);
    expect(methodsCalled).not.toContain(LspMethods.DEFINITION);
  });

  it("resolves a cross-file symbol-level calls edge via documentSymbol + references (Rust)", async () => {
    const customWorkspace = makeWorkspace({
      "a.rs": "pub struct Greeter;\nimpl Greeter {\n    pub fn hello() {}\n}\n",
      "b.rs": "use crate::a::Greeter;\nfn run() {\n    Greeter::hello();\n}\n",
    });
    const aUri = uriFor(customWorkspace, "a.rs");
    const bUri = uriFor(customWorkspace, "b.rs");

    const helloSelectionRange = range(2, 11, 2, 16);
    const runSelectionRange = range(1, 3, 1, 6);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "Greeter",
              kind: LspSymbolKinds.CLASS,
              range: range(0, 0, 3, 1),
              selectionRange: range(0, 11, 0, 18),
              children: [
                {
                  name: "hello",
                  kind: LspSymbolKinds.METHOD,
                  range: range(2, 4, 2, 21),
                  selectionRange: helloSelectionRange,
                },
              ],
            },
          ];
        }
        if (params.textDocument.uri === bUri) {
          return [
            {
              name: "run",
              kind: LspSymbolKinds.FUNCTION,
              range: range(1, 0, 3, 1),
              selectionRange: runSelectionRange,
            },
          ];
        }
        return [];
      }
      if (method === LspMethods.REFERENCES) {
        if (
          params.textDocument.uri === aUri &&
          params.position.line === helloSelectionRange.start.line &&
          params.position.character === helloSelectionRange.start.character
        ) {
          return [{ uri: bUri, range: range(2, 13, 2, 18) }];
        }
        return [];
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const fake = new FakeLspClient(handler);
    const provider = makeRustProvider(fake);

    try {
      const outcome = await provider.resolveEdges({
        workspaceRoot: customWorkspace,
        files: ["a.rs", "b.rs"],
      });

      expect(outcome.filesFailed).toEqual([]);
      expect(outcome.filesProcessed).toEqual(["a.rs", "b.rs"]);
      expect(outcome.edges).toEqual([
        {
          sourceNodeKey: "b.rs#run",
          targetNodeKey: "a.rs#Greeter.hello",
          source: "lsp",
        },
      ]);
    } finally {
      fs.rmSync(customWorkspace, { recursive: true, force: true });
    }
  });

  it("emits structurally-distinct qualified node_keys for same-named methods under distinct impl blocks (GRPH-006: rust-analyzer nests methods under kind-Object(19) 'impl <Type>' parents; the ancestor walk must elevate Object-kind and strip the leading 'impl ' so 'a.rs#ClassA.handle' and 'a.rs#ClassB.handle' no longer collide on a flat key)", async () => {
    // Mirrors rust-analyzer 1.97.1's real documentSymbol shape (verified against a live server,
    // see docs/cli-test-analysis/rust-cli-benchmark.md §3): impl blocks come back as parent
    // symbols of kind Object (19) named "impl <Type>"; the structs themselves report kind
    // Struct (23) and never act as containment ancestors (impl is a sibling, not a child).
    const customWorkspace = makeWorkspace({
      "a.rs":
        "struct ClassA;\nimpl ClassA {\n    fn handle() {}\n}\nstruct ClassB;\nimpl ClassB {\n    fn handle() {}\n}\n",
      "b.rs": "fn caller() {}\n",
    });
    const aUri = uriFor(customWorkspace, "a.rs");
    const bUri = uriFor(customWorkspace, "b.rs");
    const classAHandleSelection = range(2, 8, 2, 14);
    const classBHandleSelection = range(6, 8, 6, 14);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "ClassA",
              kind: 23,
              range: range(0, 0, 0, 12),
              selectionRange: range(0, 6, 0, 12),
            },
            {
              name: "impl ClassA",
              kind: LspSymbolKinds.OBJECT,
              range: range(1, 0, 3, 1),
              selectionRange: range(1, 0, 1, 11),
              children: [
                {
                  name: "handle",
                  kind: LspSymbolKinds.METHOD,
                  range: range(2, 4, 2, 20),
                  selectionRange: classAHandleSelection,
                },
              ],
            },
            {
              name: "ClassB",
              kind: 23,
              range: range(4, 0, 4, 12),
              selectionRange: range(4, 6, 4, 12),
            },
            {
              name: "impl ClassB",
              kind: LspSymbolKinds.OBJECT,
              range: range(5, 0, 7, 1),
              selectionRange: range(5, 0, 5, 11),
              children: [
                {
                  name: "handle",
                  kind: LspSymbolKinds.METHOD,
                  range: range(6, 4, 6, 20),
                  selectionRange: classBHandleSelection,
                },
              ],
            },
          ];
        }
        return [
          {
            name: "caller",
            kind: LspSymbolKinds.FUNCTION,
            range: range(0, 0, 3, 1),
            selectionRange: range(0, 3, 0, 9),
          },
        ];
      }
      if (method === LspMethods.REFERENCES) {
        if (params.textDocument.uri === aUri) {
          if (params.position.line === classAHandleSelection.start.line) {
            return [{ uri: bUri, range: range(1, 2, 1, 8) }];
          }
          if (params.position.line === classBHandleSelection.start.line) {
            return [{ uri: bUri, range: range(2, 2, 2, 8) }];
          }
          return [];
        }
        return [];
      }
      return undefined;
    };

    const provider = makeRustProvider(new FakeLspClient(handler));

    try {
      const outcome = await provider.resolveEdges({
        workspaceRoot: customWorkspace,
        files: ["a.rs", "b.rs"],
      });

      expect(outcome.edges).toEqual(
        expect.arrayContaining([
          {
            sourceNodeKey: "b.rs#caller",
            targetNodeKey: "a.rs#ClassA.handle",
            source: "lsp",
          },
          {
            sourceNodeKey: "b.rs#caller",
            targetNodeKey: "a.rs#ClassB.handle",
            source: "lsp",
          },
        ]),
      );
      expect(outcome.edges).toHaveLength(2);
    } finally {
      fs.rmSync(customWorkspace, { recursive: true, force: true });
    }
  });

  it("maps an impl-block method onto Tier A's qualified 'file#Struct.method' node_key using rust-analyzer's real nesting shape (kind-Object(19) parent named 'impl <Type>'; associated fn kind 12 / method kind 6)", async () => {
    // The exact shape verified live against rust-analyzer 1.97.1 on ripgrep's haystack.rs (issue
    // #31, docs/cli-test-analysis/rust-cli-benchmark.md §3): an impl block is a parent symbol of
    // kind Object(19) named "impl HaystackBuilder"; `new` (associated fn) is kind Function(12),
    // `build` is kind Method(6), the struct is kind Struct(23). The containment ancestor walk must
    // elevate Object-kind AND strip the "impl " prefix for the emitted key to match Tier A's
    // `file#HaystackBuilder.build` (`resolveRustImplContainerName` qualifies by the bare struct
    // name) -- previously `findNodeIdByNodeKey` dropped every such cross-file edge (0 corrected
    // edges on both ripgrep and tauri).
    const customWorkspace = makeWorkspace({
      "a.rs":
        "pub struct HaystackBuilder;\nimpl HaystackBuilder {\n    pub fn new() {}\n    pub fn build() {}\n}\n",
      "b.rs": "fn run() {\n    HaystackBuilder::build();\n}\n",
    });
    const aUri = uriFor(customWorkspace, "a.rs");
    const bUri = uriFor(customWorkspace, "b.rs");
    const newSelectionRange = range(2, 15, 2, 18);
    const buildSelectionRange = range(3, 15, 3, 20);
    const runSelectionRange = range(0, 3, 0, 6);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "HaystackBuilder",
              kind: 23,
              range: range(0, 0, 0, 24),
              selectionRange: range(0, 11, 0, 27),
            },
            {
              name: "impl HaystackBuilder",
              kind: LspSymbolKinds.OBJECT,
              range: range(1, 0, 4, 1),
              selectionRange: range(1, 0, 1, 19),
              children: [
                {
                  name: "new",
                  kind: LspSymbolKinds.FUNCTION,
                  range: range(2, 4, 2, 20),
                  selectionRange: newSelectionRange,
                },
                {
                  name: "build",
                  kind: LspSymbolKinds.METHOD,
                  range: range(3, 4, 3, 22),
                  selectionRange: buildSelectionRange,
                },
              ],
            },
          ];
        }
        if (params.textDocument.uri === bUri) {
          return [
            {
              name: "run",
              kind: LspSymbolKinds.FUNCTION,
              range: range(0, 0, 2, 1),
              selectionRange: runSelectionRange,
            },
          ];
        }
        return [];
      }
      if (method === LspMethods.REFERENCES) {
        if (
          params.textDocument.uri === aUri &&
          params.position.line === buildSelectionRange.start.line &&
          params.position.character === buildSelectionRange.start.character
        ) {
          return [{ uri: bUri, range: range(1, 4, 1, 9) }];
        }
        return [];
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const fake = new FakeLspClient(handler);
    const provider = makeRustProvider(fake);

    try {
      const outcome = await provider.resolveEdges({
        workspaceRoot: customWorkspace,
        files: ["a.rs", "b.rs"],
      });

      expect(outcome.filesFailed).toEqual([]);
      expect(outcome.edges).toEqual([
        {
          sourceNodeKey: "b.rs#run",
          targetNodeKey: "a.rs#HaystackBuilder.build",
          source: "lsp",
        },
      ]);
    } finally {
      fs.rmSync(customWorkspace, { recursive: true, force: true });
    }
  });

  it("opens each file with the rust languageId", async () => {
    const handler: RequestHandler = (method) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) return [];
      return undefined;
    };
    const fake = new FakeLspClient(handler);
    const provider = makeRustProvider(fake);

    await provider.resolveEdges({ workspaceRoot, files: ["main.rs"] });

    const didOpen = fake.notifications.find(
      (n) => n.method === LspMethods.DID_OPEN,
    );
    expect((didOpen?.params as any).textDocument.languageId).toBe("rust");
  });

  it("waits the configured cold-start settle before the first semantic request (rust-analyzer returns empty references until its async crate-graph load finishes -- the 0-corrected-edges root cause on ripgrep/tauri)", async () => {
    const order: string[] = [];
    const settleMs = 120;
    const handler: RequestHandler = (method) => {
      order.push(method);
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) return [];
      if (method === LspMethods.REFERENCES) return [];
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };
    const fake = new FakeLspClient(handler);
    const provider = new RustLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );
    provider.configure({ coldStartSettleMs: settleMs });

    const t0 = Date.now();
    await provider.resolveEdges({ workspaceRoot, files: ["main.rs"] });
    const elapsed = Date.now() - t0;

    // The cold-start settle is paid once per spawned server, before the first file's symbols.
    expect(elapsed).toBeGreaterThanOrEqual(settleMs);
    const initIdx = order.indexOf(LspMethods.INITIALIZE);
    const symbolIdx = order.indexOf(LspMethods.DOCUMENT_SYMBOL);
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(symbolIdx).toBeGreaterThan(initIdx);
  });

  it("applies the batch-provided coldStartSettleMs override (0 disables the language default)", async () => {
    const order: string[] = [];
    const handler: RequestHandler = (method) => {
      order.push(method);
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) return [];
      if (method === LspMethods.REFERENCES) return [];
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };
    const fake = new FakeLspClient(handler);
    const provider = new RustLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );
    // rust's language default is 8s; a caller forcing 0 must skip the wait entirely.
    provider.configure({ coldStartSettleMs: 0 });

    const t0 = Date.now();
    await provider.resolveEdges({ workspaceRoot, files: ["main.rs"] });
    const elapsed = Date.now() - t0;

    // No settle wait: documentSymbol follows initialize immediately (well under the 8s default).
    expect(elapsed).toBeLessThan(5000);
    expect(order).toContain(LspMethods.DOCUMENT_SYMBOL);
  });
});
