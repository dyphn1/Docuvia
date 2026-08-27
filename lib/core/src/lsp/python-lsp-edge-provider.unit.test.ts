import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLogger } from "@workspace/contracts";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { PythonLspEdgeProvider } from "./python-lsp-edge-provider.js";
import { LspMethods, LspSymbolKinds } from "./lsp-constants.js";
import { PY_LSP_MESSAGES } from "./python-lsp-constants.js";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { rmSyncRetrying } from "./windows-rm-retry.test-support.js";

/**
 * Mirrors `typescript-lsp-edge-provider.unit.test.ts`'s shape exactly (fake `LspJsonRpcClient`,
 * no real process spawn) -- proves `PythonLspEdgeProvider`'s wiring onto `BaseLspEdgeProvider`
 * behaves identically to TS's for the generic batch/reference-resolution logic, only exercised
 * through Python's own extension/languageId config this time.
 */
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-pylsp-test-"));
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

describe("PythonLspEdgeProvider.resolveEdges()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeWorkspace({
      "a.py": "def foo():\n    pass\n",
      "b.py": "from a import foo\n\ndef bar():\n    foo()\n",
    });
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns an empty outcome without touching the client factory when files is empty", async () => {
    const clientFactory = vi.fn();
    const provider = new PythonLspEdgeProvider(
      createMockLogger(),
      clientFactory,
    );

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
            name: "foo",
            kind: LspSymbolKinds.FUNCTION,
            range: range(0, 0, 1, 8),
            selectionRange: range(0, 4, 0, 7),
          },
        ];
      }
      if (method === LspMethods.REFERENCES) return [];
      if (method === LspMethods.DEFINITION) {
        return { uri: uriFor(workspaceRoot, "a.py"), range: range(0, 4, 0, 7) };
      }
      return undefined;
    };
    const fake = new FakeLspClient(handler);
    const provider = new PythonLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    await provider.resolveEdges({
      workspaceRoot,
      files: ["a.py"],
      callsByFile: {
        "a.py": [{ targetFunction: "foo", startLine: 0, startColumn: 4 }],
      },
    });

    expect(methodsCalled).toContain(LspMethods.REFERENCES);
    expect(methodsCalled).not.toContain(LspMethods.DEFINITION);
  });

  it("resolves a cross-file symbol-level calls edge via documentSymbol + references", async () => {
    const aUri = uriFor(workspaceRoot, "a.py");
    const bUri = uriFor(workspaceRoot, "b.py");

    const fooSelectionRange = range(0, 4, 0, 7);
    const barSelectionRange = range(2, 4, 2, 7);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "foo",
              kind: LspSymbolKinds.FUNCTION,
              range: range(0, 0, 1, 8),
              selectionRange: fooSelectionRange,
            },
          ];
        }
        if (params.textDocument.uri === bUri) {
          return [
            {
              name: "bar",
              kind: LspSymbolKinds.FUNCTION,
              range: range(2, 0, 3, 9),
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
    const provider = new PythonLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.py", "b.py"],
    });

    expect(outcome.filesFailed).toEqual([]);
    expect(outcome.filesProcessed).toEqual(["a.py", "b.py"]);
    expect(outcome.edges).toEqual([
      { sourceNodeKey: "b.py#bar", targetNodeKey: "a.py#foo", source: "lsp" },
    ]);
    expect(fake.started).toBe(true);
    expect(fake.stopped).toBe(true);
  });

  it("resolves the same cross-file edge at maxConcurrentFiles: 4 as at the K=1 default (Tier B K-way concurrency plan, reverse-path parity -- proves the worker pool isn't TS/forward-only)", async () => {
    const aUri = uriFor(workspaceRoot, "a.py");
    const bUri = uriFor(workspaceRoot, "b.py");

    const fooSelectionRange = range(0, 4, 0, 7);
    const barSelectionRange = range(2, 4, 2, 7);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "foo",
              kind: LspSymbolKinds.FUNCTION,
              range: range(0, 0, 1, 8),
              selectionRange: fooSelectionRange,
            },
          ];
        }
        if (params.textDocument.uri === bUri) {
          return [
            {
              name: "bar",
              kind: LspSymbolKinds.FUNCTION,
              range: range(2, 0, 3, 9),
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
    const provider = new PythonLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );
    provider.configure({ maxConcurrentFiles: 4 });

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.py", "b.py"],
    });

    expect(outcome.filesFailed).toEqual([]);
    expect(outcome.filesProcessed).toEqual(["a.py", "b.py"]);
    expect(outcome.edges).toEqual([
      { sourceNodeKey: "b.py#bar", targetNodeKey: "a.py#foo", source: "lsp" },
    ]);
    expect(fake.started).toBe(true);
    expect(fake.stopped).toBe(true);
  });

  it("opens each file with the python languageId", async () => {
    const handler: RequestHandler = (method) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) return [];
      return undefined;
    };
    const fake = new FakeLspClient(handler);
    const provider = new PythonLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    await provider.resolveEdges({ workspaceRoot, files: ["a.py"] });

    const didOpen = fake.notifications.find(
      (n) => n.method === LspMethods.DID_OPEN,
    );
    expect((didOpen?.params as any).textDocument.languageId).toBe("python");
  });

  it("degrades honestly (unavailableReason set, no edges) when the client fails to spawn", async () => {
    const fake = new FakeLspClient();
    fake.startError = new Error("ENOENT: no such file or directory");
    const provider = new PythonLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.py"],
    });

    expect(outcome.edges).toEqual([]);
    expect(outcome.filesFailed).toEqual([]);
    expect(outcome.unavailableReason).toMatch(/Failed to spawn LSP server/);
  });

  it("degrades honestly (never throws) when the process spawns but exits before completing initialize -- e.g. npx --no-install starting then exiting for an uncached package", async () => {
    // Regression coverage found via a real `pyright-langserver` spawn during this slice's
    // implementation: `npx --no-install --package pyright pyright-langserver` starts a real
    // process (so `client.start()` resolves fine, no spawn-failure catch fires), then exits
    // quickly once npx itself determines the package isn't cached -- which used to reject
    // `resolveEdges()` entirely instead of returning a clean degraded outcome, violating
    // `IEdgeResolutionProvider.resolveEdges()`'s "never throws for an ordinary unavailable
    // outcome" contract. Not Python-specific -- any npx/npm-fallback language can hit this.
    // Since issue #32, this npx-fallback initialize-exit shape also substitutes python's own
    // friendly `binaryUnresolvable` wording instead of leaking the raw process error (which for
    // npm >= 9 contains `npm error npx canceled due to missing packages...`).
    const client: LspJsonRpcClient = {
      start: vi.fn().mockResolvedValue(undefined),
      request: vi
        .fn()
        .mockRejectedValue(
          new Error(
            `LSP server process exited (code=1) -- stderr: npm error npx canceled due to missing packages and no YES option: ["pyright"]`,
          ),
        ),
      notify: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as LspJsonRpcClient;

    const provider = new PythonLspEdgeProvider(
      createMockLogger(),
      () => client,
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.py"],
    });

    expect(outcome.edges).toEqual([]);
    expect(outcome.filesFailed).toEqual([]);
    expect(outcome.unavailableReason).toBe(PY_LSP_MESSAGES.binaryUnresolvable);
    expect(outcome.unavailableReason).not.toMatch(/npm error/);
    expect(client.stop).toHaveBeenCalled();
  });
});

describe("PythonLspEdgeProvider.checkAvailability()", () => {
  it("reports unavailable with a reason when no pyproject.toml/requirements.txt marker is present", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-pylsp-avail-test-"),
    );
    try {
      const provider = new PythonLspEdgeProvider(createMockLogger());
      const availability = await provider.checkAvailability(dir);

      expect(availability.available).toBe(false);
      expect(availability.reason!.length).toBeGreaterThanOrEqual(1);
    } finally {
      await rmSyncRetrying(dir);
    }
  }, 30_000);

  it("reports the pyright binary as unresolvable once a marker file is present but pyright is not", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-pylsp-avail-test-"),
    );
    try {
      fs.writeFileSync(path.join(dir, "pyproject.toml"), "[project]\n");
      const provider = new PythonLspEdgeProvider(createMockLogger());
      const availability = await provider.checkAvailability(dir);

      expect(availability.available).toBe(false);
      expect(availability.reason).toMatch(/not resolvable/);
    } finally {
      await rmSyncRetrying(dir);
    }
  }, 30_000);
});
