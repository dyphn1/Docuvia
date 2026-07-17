import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLogger } from "@workspace/contracts";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { TypescriptLspEdgeProvider } from "./typescript-lsp-edge-provider.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-lsp-test-"));
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

describe("TypescriptLspEdgeProvider.resolveEdges()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeWorkspace({
      "a.ts": "export function foo() {}\n",
      "b.ts": "export function bar() {\n  foo();\n}\n",
    });
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns an empty outcome without touching the client factory when files is empty", async () => {
    const clientFactory = vi.fn();
    const provider = new TypescriptLspEdgeProvider(
      createMockLogger(),
      clientFactory,
    );

    const outcome = await provider.resolveEdges({ workspaceRoot, files: [] });

    expect(outcome).toEqual({ edges: [], filesProcessed: [], filesFailed: [] });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("resolves a cross-file symbol-level calls edge via documentSymbol + references (§8d)", async () => {
    const aUri = uriFor(workspaceRoot, "a.ts");
    const bUri = uriFor(workspaceRoot, "b.ts");

    const fooSelectionRange = range(0, 16, 0, 19);
    const barSelectionRange = range(0, 16, 0, 19);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "foo",
              kind: LspSymbolKinds.FUNCTION,
              range: range(0, 0, 0, 25),
              selectionRange: fooSelectionRange,
            },
          ];
        }
        if (params.textDocument.uri === bUri) {
          return [
            {
              name: "bar",
              kind: LspSymbolKinds.FUNCTION,
              range: range(0, 0, 2, 1),
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
          return [{ uri: bUri, range: range(1, 2, 1, 5) }];
        }
        return [];
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const fake = new FakeLspClient(handler);
    const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts", "b.ts"],
    });

    expect(outcome.filesFailed).toEqual([]);
    expect(outcome.filesProcessed).toEqual(["a.ts", "b.ts"]);
    expect(outcome.edges).toEqual([
      { sourceNodeKey: "b.ts#bar", targetNodeKey: "a.ts#foo", source: "lsp" },
    ]);
    expect(fake.started).toBe(true);
    expect(fake.stopped).toBe(true);
  });

  it("falls back to the file-level node_key when the reference has no enclosing call-site symbol", async () => {
    const aUri = uriFor(workspaceRoot, "a.ts");
    const bUri = uriFor(workspaceRoot, "b.ts");
    const fooSelectionRange = range(0, 16, 0, 19);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "foo",
              kind: LspSymbolKinds.FUNCTION,
              range: range(0, 0, 0, 25),
              selectionRange: fooSelectionRange,
            },
          ];
        }
        return [];
      }
      if (method === LspMethods.REFERENCES) {
        if (params.textDocument.uri === aUri) {
          return [{ uri: bUri, range: range(1, 2, 1, 5) }];
        }
        return [];
      }
      return undefined;
    };

    const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
      asClient(new FakeLspClient(handler)),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts"],
    });

    expect(outcome.edges).toEqual([
      { sourceNodeKey: "b.ts", targetNodeKey: "a.ts#foo", source: "lsp" },
    ]);
  });

  it("skips a same-file reference (already covered by AST-level edges)", async () => {
    const aUri = uriFor(workspaceRoot, "a.ts");
    const fooSelectionRange = range(0, 16, 0, 19);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        return [
          {
            name: "foo",
            kind: LspSymbolKinds.FUNCTION,
            range: range(0, 0, 0, 25),
            selectionRange: fooSelectionRange,
          },
        ];
      }
      if (method === LspMethods.REFERENCES) {
        return [{ uri: aUri, range: range(0, 30, 0, 33) }];
      }
      return undefined;
    };

    const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
      asClient(new FakeLspClient(handler)),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts"],
    });

    expect(outcome.edges).toEqual([]);
  });

  it("dedupes multiple call sites in the same caller symbol into a single edge", async () => {
    const aUri = uriFor(workspaceRoot, "a.ts");
    const bUri = uriFor(workspaceRoot, "b.ts");
    const fooSelectionRange = range(0, 16, 0, 19);
    const barSelectionRange = range(0, 16, 0, 19);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "foo",
              kind: LspSymbolKinds.FUNCTION,
              range: range(0, 0, 0, 25),
              selectionRange: fooSelectionRange,
            },
          ];
        }
        return [
          {
            name: "bar",
            kind: LspSymbolKinds.FUNCTION,
            range: range(0, 0, 3, 1),
            selectionRange: barSelectionRange,
          },
        ];
      }
      if (method === LspMethods.REFERENCES) {
        if (params.textDocument.uri === aUri) {
          return [
            { uri: bUri, range: range(1, 2, 1, 5) },
            { uri: bUri, range: range(2, 2, 2, 5) },
          ];
        }
        return [];
      }
      return undefined;
    };

    const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
      asClient(new FakeLspClient(handler)),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts", "b.ts"],
    });

    expect(outcome.edges).toHaveLength(1);
    expect(outcome.edges[0]).toEqual({
      sourceNodeKey: "b.ts#bar",
      targetNodeKey: "a.ts#foo",
      source: "lsp",
    });
  });

  it("keeps a per-file failure isolated -- other files still succeed (§8g)", async () => {
    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === uriFor(workspaceRoot, "a.ts")) {
          throw new Error("server choked on a.ts");
        }
        return [];
      }
      return undefined;
    };

    const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
      asClient(new FakeLspClient(handler)),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts", "b.ts"],
    });

    expect(outcome.filesFailed).toEqual([
      { file: "a.ts", reason: "server choked on a.ts" },
    ]);
    expect(outcome.filesProcessed).toEqual(["b.ts"]);
  });

  it("degrades honestly (unavailableReason set, no edges) when the client fails to spawn", async () => {
    const fake = new FakeLspClient();
    fake.startError = new Error("ENOENT: no such file or directory");
    const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts"],
    });

    expect(outcome.edges).toEqual([]);
    expect(outcome.filesFailed).toEqual([]);
    expect(outcome.unavailableReason).toMatch(/Failed to spawn LSP server/);
  });

  it("degrades honestly on a whole-batch timeout and stops the client", async () => {
    let stopped = false;
    const hangingClient: LspJsonRpcClient = {
      start: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockImplementation(() => new Promise(() => {})),
      notify: vi.fn(),
      stop: vi.fn().mockImplementation(async () => {
        stopped = true;
      }),
    } as unknown as LspJsonRpcClient;

    const provider = new TypescriptLspEdgeProvider(
      createMockLogger(),
      () => hangingClient,
    );
    provider.configure({ timeoutMs: 20 });

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts"],
    });

    expect(outcome.edges).toEqual([]);
    expect(outcome.unavailableReason).toMatch(/exceeded its 20ms timeout/);
    expect(stopped).toBe(true);
  });
});

describe("TypescriptLspEdgeProvider.checkAvailability()", () => {
  it("reports unavailable with a reason when node_modules is missing", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-lsp-avail-test-"),
    );
    try {
      const provider = new TypescriptLspEdgeProvider(createMockLogger());
      const availability = await provider.checkAvailability(dir);

      expect(availability.available).toBe(false);
      expect(availability.reason).toBeTruthy();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
