import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLogger } from "@workspace/contracts";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { GoLspEdgeProvider } from "./go-lsp-edge-provider.js";
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

function makeWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-golsp-test-"));
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

describe("GoLspEdgeProvider.resolveEdges()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeWorkspace({
      "a.go": "package main\n\nfunc Foo() {}\n",
      "b.go": "package main\n\nfunc Bar() {\n    Foo()\n}\n",
    });
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns an empty outcome without touching the client factory when files is empty", async () => {
    const clientFactory = vi.fn();
    const provider = new GoLspEdgeProvider(createMockLogger(), clientFactory);

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
            name: "Foo",
            kind: LspSymbolKinds.FUNCTION,
            range: range(2, 0, 2, 14),
            selectionRange: range(2, 5, 2, 8),
          },
        ];
      }
      if (method === LspMethods.REFERENCES) return [];
      if (method === LspMethods.DEFINITION) {
        return { uri: uriFor(workspaceRoot, "a.go"), range: range(2, 5, 2, 8) };
      }
      return undefined;
    };
    const fake = new FakeLspClient(handler);
    const provider = new GoLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    await provider.resolveEdges({
      workspaceRoot,
      files: ["a.go"],
      callsByFile: {
        "a.go": [{ targetFunction: "Foo", startLine: 2, startColumn: 5 }],
      },
    });

    expect(methodsCalled).toContain(LspMethods.REFERENCES);
    expect(methodsCalled).not.toContain(LspMethods.DEFINITION);
  });

  it("resolves a cross-file symbol-level calls edge via documentSymbol + references", async () => {
    const aUri = uriFor(workspaceRoot, "a.go");
    const bUri = uriFor(workspaceRoot, "b.go");

    const fooSelectionRange = range(2, 5, 2, 8);
    const barSelectionRange = range(2, 5, 2, 8);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "Foo",
              kind: LspSymbolKinds.FUNCTION,
              range: range(2, 0, 2, 13),
              selectionRange: fooSelectionRange,
            },
          ];
        }
        if (params.textDocument.uri === bUri) {
          return [
            {
              name: "Bar",
              kind: LspSymbolKinds.FUNCTION,
              range: range(2, 0, 4, 1),
              selectionRange: barSelectionRange,
            },
          ];
        }
        return [];
      }
      if (method === LspMethods.REFERENCES) {
        if (
          params.textDocument.uri === aUri &&
          params.position.character === fooSelectionRange.start.character
        ) {
          return [{ uri: bUri, range: range(3, 4, 3, 7) }];
        }
        return [];
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const fake = new FakeLspClient(handler);
    const provider = new GoLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.go", "b.go"],
    });

    expect(outcome.filesFailed).toEqual([]);
    expect(outcome.filesProcessed).toEqual(["a.go", "b.go"]);
    expect(outcome.edges).toEqual([
      { sourceNodeKey: "b.go#Bar", targetNodeKey: "a.go#Foo", source: "lsp" },
    ]);
    expect(fake.started).toBe(true);
    expect(fake.stopped).toBe(true);
  });

  it("maps a Go method's gopls '(Receiver).Method' documentSymbol name onto Tier A's qualified 'file#Receiver.Method' node_key (gopls does not nest receiver methods under the struct -- GRPH-006 -- so containment must be recovered from the name, not the symbol tree)", async () => {
    const aUri = uriFor(workspaceRoot, "a.go");
    const bUri = uriFor(workspaceRoot, "b.go");

    // A receiver method as gopls v0.23.0 actually returns it: flat top-level entry, name
    // "(A).Handle" (kind METHOD), never nested under the struct's symbol -- plus an unrelated
    // struct kind 23 (Struct) at the same depth, which is NOT a call-site kind.
    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "(A).Handle",
              kind: LspSymbolKinds.METHOD,
              range: range(2, 0, 2, 19),
              selectionRange: range(2, 11, 2, 17),
            },
          ];
        }
        if (params.textDocument.uri === bUri) {
          return [
            {
              name: "Bar",
              kind: LspSymbolKinds.FUNCTION,
              range: range(2, 0, 4, 1),
              selectionRange: range(2, 5, 2, 8),
            },
          ];
        }
        return [];
      }
      if (method === LspMethods.REFERENCES) {
        if (params.textDocument.uri === aUri) {
          return [{ uri: bUri, range: range(3, 4, 3, 7) }];
        }
        return [];
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const fake = new FakeLspClient(handler);
    const provider = new GoLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.go", "b.go"],
    });

    expect(outcome.filesFailed).toEqual([]);
    expect(outcome.edges).toEqual([
      {
        sourceNodeKey: "b.go#Bar",
        targetNodeKey: "a.go#A.Handle",
        source: "lsp",
      },
    ]);
  });

  it("maps a pointer-receiver method's gopls '(*B).Visit' name onto Tier A's 'file#B.Visit' node_key (pointer stripped exactly as Tier A's firstTypeIdentifierText unwraps pointer_type)", async () => {
    const aUri = uriFor(workspaceRoot, "a.go");
    const bUri = uriFor(workspaceRoot, "b.go");

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "(*B).Visit",
              kind: LspSymbolKinds.METHOD,
              range: range(2, 0, 2, 18),
              selectionRange: range(2, 12, 2, 17),
            },
          ];
        }
        if (params.textDocument.uri === bUri) {
          return [
            {
              name: "Caller",
              kind: LspSymbolKinds.FUNCTION,
              range: range(2, 0, 4, 1),
              selectionRange: range(2, 5, 2, 11),
            },
          ];
        }
        return [];
      }
      if (method === LspMethods.REFERENCES) {
        if (params.textDocument.uri === aUri) {
          return [{ uri: bUri, range: range(3, 4, 3, 9) }];
        }
        return [];
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const fake = new FakeLspClient(handler);
    const provider = new GoLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.go", "b.go"],
    });

    expect(outcome.filesFailed).toEqual([]);
    expect(outcome.edges).toEqual([
      {
        sourceNodeKey: "b.go#Caller",
        targetNodeKey: "a.go#B.Visit",
        source: "lsp",
      },
    ]);
  });

  it("opens each file with the go languageId", async () => {
    const handler: RequestHandler = (method) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) return [];
      return undefined;
    };
    const fake = new FakeLspClient(handler);
    const provider = new GoLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    await provider.resolveEdges({ workspaceRoot, files: ["a.go"] });

    const didOpen = fake.notifications.find(
      (n) => n.method === LspMethods.DID_OPEN,
    );
    expect((didOpen?.params as any).textDocument.languageId).toBe("go");
  });

  it("degrades honestly (unavailableReason set, no edges) when the client fails to spawn", async () => {
    const fake = new FakeLspClient();
    fake.startError = new Error("ENOENT: no such file or directory");
    const provider = new GoLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.go"],
    });

    expect(outcome.edges).toEqual([]);
    expect(outcome.filesFailed).toEqual([]);
    expect(outcome.unavailableReason).toMatch(/Failed to spawn LSP server/);
  });
});

describe("GoLspEdgeProvider.checkAvailability()", () => {
  it("reports unavailable with a reason when no go.mod marker is present", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-golsp-avail-test-"),
    );
    try {
      const provider = new GoLspEdgeProvider(createMockLogger());
      const availability = await provider.checkAvailability(dir);

      expect(availability.available).toBe(false);
      expect(availability.reason).toBeTruthy();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
