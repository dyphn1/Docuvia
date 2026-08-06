import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLogger } from "@workspace/contracts";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { TypescriptLspEdgeProvider } from "./typescript-lsp-edge-provider.js";
import { LspMethods, LspSymbolKinds } from "./lsp-constants.js";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { rmSyncRetrying } from "./windows-rm-retry.test-support.js";

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

  it("closes each file's document once its own batch turn finishes, so a large batch doesn't accumulate every touched file's document in the server's memory for the whole run (vscode-scale Tier B crash fix)", async () => {
    const aUri = uriFor(workspaceRoot, "a.ts");
    const bUri = uriFor(workspaceRoot, "b.ts");
    const fooSelectionRange = range(0, 16, 0, 19);

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
              selectionRange: range(0, 16, 0, 19),
            },
          ];
        }
        return [];
      }
      if (method === LspMethods.REFERENCES) {
        // a.ts's `foo` is referenced from b.ts -- resolving that reference opens b.ts as a
        // *caller* file mid-way through a.ts's own turn, before b.ts ever reaches its own turn
        // in `files` below.
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

    const opens = fake.notifications.filter(
      (n) => n.method === LspMethods.DID_OPEN,
    );
    const closes = fake.notifications.filter(
      (n) => n.method === LspMethods.DID_CLOSE,
    );

    // b.ts is opened exactly once even though it's touched twice (as a.ts's caller, then again
    // on its own turn) -- the batch-scoped cache still dedupes opens; only closing changed.
    expect(opens.map((n: any) => n.params.textDocument.uri).sort()).toEqual(
      [aUri, bUri].sort(),
    );
    // Every file opened during the batch is closed exactly once by the time it ends -- nothing
    // is left dangling open in the server.
    expect(closes.map((n: any) => n.params.textDocument.uri).sort()).toEqual(
      [aUri, bUri].sort(),
    );

    // a.ts is closed right after its own turn -- specifically, before b.ts's turn even starts
    // re-requesting its (already-cached) documentSymbol -- proving the cache entry was evicted
    // per-file, not held onto for the rest of the batch.
    const aCloseIndex = fake.notifications.findIndex(
      (n) =>
        n.method === LspMethods.DID_CLOSE &&
        (n.params as any).textDocument.uri === aUri,
    );
    const bCloseIndex = fake.notifications.findIndex(
      (n) =>
        n.method === LspMethods.DID_CLOSE &&
        (n.params as any).textDocument.uri === bUri,
    );
    expect(aCloseIndex).toBeGreaterThanOrEqual(0);
    expect(bCloseIndex).toBeGreaterThan(aCloseIndex);
  });

  it("never holds more than the configured maxOpenFiles documents open at once, even when a file's references open several callers as a side effect before their own queue turn (bounded-LRU open-file cache)", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "c.ts"), "foo();\n", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "d.ts"), "foo();\n", "utf8");

    const aUri = uriFor(workspaceRoot, "a.ts");
    const bUri = uriFor(workspaceRoot, "b.ts");
    const cUri = uriFor(workspaceRoot, "c.ts");
    const dUri = uriFor(workspaceRoot, "d.ts");
    const fooSelectionRange = range(0, 16, 0, 19);

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
        // b.ts/c.ts/d.ts have no symbols of their own -- only their open/close accounting
        // matters for this test, not the edges they'd otherwise produce.
        return [];
      }
      if (method === LspMethods.REFERENCES) {
        // a.ts's `foo` is referenced from b.ts, c.ts, and d.ts -- resolving these opens all
        // three as *caller* files mid-way through a.ts's own turn, well before any of them
        // reaches its own turn in `files` below.
        if (
          params.textDocument.uri === aUri &&
          params.position.character === fooSelectionRange.start.character
        ) {
          return [
            { uri: bUri, range: range(0, 0, 0, 3) },
            { uri: cUri, range: range(0, 0, 0, 3) },
            { uri: dUri, range: range(0, 0, 0, 3) },
          ];
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
    provider.configure({ maxOpenFiles: 2 });

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts", "b.ts", "c.ts", "d.ts"],
    });

    expect(outcome.filesFailed).toEqual([]);

    // Replay DID_OPEN/DID_CLOSE in order, tracking which files are currently open, and assert
    // the open set never exceeds the configured cap at any point -- not just on average.
    const openSet = new Set<string>();
    let maxConcurrentlyOpen = 0;
    for (const n of fake.notifications) {
      if (n.method === LspMethods.DID_OPEN) {
        openSet.add((n.params as any).textDocument.uri);
      } else if (n.method === LspMethods.DID_CLOSE) {
        openSet.delete((n.params as any).textDocument.uri);
      }
      maxConcurrentlyOpen = Math.max(maxConcurrentlyOpen, openSet.size);
    }

    expect(maxConcurrentlyOpen).toBeLessThanOrEqual(2);
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

  it("skips a reference that resolves outside the workspace instead of crashing on it (e.g. TypeScript's global Automatic Type Acquisition cache)", async () => {
    // Regression guard: `resolveReferenceEdge` used to join whatever `path.relative()` produced
    // straight onto workspaceRoot with no "is this actually inside the workspace" check. On
    // Windows, `path.relative()` across drive letters (a real, common shape for a reference into
    // %LOCALAPPDATA%\Microsoft\TypeScript\...\node_modules\csstype while the project lives on a
    // different drive) returns the target's own absolute path unchanged instead of a
    // `..`-relative one, so the downstream `path.join(workspaceRoot, thatAbsolutePath)` produced
    // an unopenable path and failed the whole file's Tier B batch. This test exercises the
    // portable, same-drive version of the same gap (a reference above workspaceRoot, so
    // `path.relative()` returns a `..`-prefixed path) since it doesn't depend on a second drive
    // letter being available in CI.
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-lsp-outside-"),
    );
    const outsideFile = path.join(outsideDir, "external.ts");
    fs.writeFileSync(outsideFile, "// not part of the workspace\n", "utf8");
    const outsideUri = pathToFileURL(outsideFile).toString();

    const aUri = uriFor(workspaceRoot, "a.ts");
    const bUri = uriFor(workspaceRoot, "b.ts");
    const fooSelectionRange = range(0, 16, 0, 19);
    const barSelectionRange = range(0, 16, 0, 19);

    try {
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
          if (params.textDocument.uri === bUri) {
            return [
              {
                name: "bar",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 0, 25),
                selectionRange: barSelectionRange,
              },
            ];
          }
          return [];
        }
        if (method === LspMethods.REFERENCES) {
          if (params.textDocument.uri === aUri) {
            return [
              { uri: outsideUri, range: range(0, 0, 0, 3) },
              { uri: bUri, range: range(0, 2, 0, 5) },
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

      expect(outcome.filesFailed).toEqual([]);
      expect(outcome.edges).toEqual([
        { sourceNodeKey: "b.ts#bar", targetNodeKey: "a.ts#foo", source: "lsp" },
      ]);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
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

  it("issues every references request for a file's call-site symbols up front, before any of them resolves (pipelines the reverse-reference fan-out -- issue #11 throughput fix)", async () => {
    let requestsIssued = 0;
    let firstResolutionSaw = 0;
    let capturedFirstResolution = false;

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        // a.ts declares three call-site symbols: foo (L0), bar (L1), baz (L2).
        return [
          {
            name: "foo",
            kind: LspSymbolKinds.FUNCTION,
            range: range(0, 0, 0, 25),
            selectionRange: range(0, 16, 0, 19),
          },
          {
            name: "bar",
            kind: LspSymbolKinds.FUNCTION,
            range: range(1, 0, 1, 25),
            selectionRange: range(1, 16, 1, 19),
          },
          {
            name: "baz",
            kind: LspSymbolKinds.FUNCTION,
            range: range(2, 0, 2, 25),
            selectionRange: range(2, 16, 2, 19),
          },
        ];
      }
      if (method === LspMethods.REFERENCES) {
        requestsIssued++;
        // Resolve after a tick so the pipelined burst has time to issue every request before the
        // first one settles. Resolves to nothing -- this test only proves *when* the requests are
        // issued relative to each other, not what they resolve to.
        return new Promise((resolve) =>
          setTimeout(() => {
            if (!capturedFirstResolution) {
              capturedFirstResolution = true;
              firstResolutionSaw = requestsIssued;
            }
            resolve([]);
          }, 10),
        );
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
      asClient(new FakeLspClient(handler)),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts"],
    });

    expect(outcome.filesProcessed).toEqual(["a.ts"]);
    expect(outcome.filesFailed).toEqual([]);
    // If the provider awaited each references before issuing the next, the first resolution would
    // observe exactly 1 request in flight. All three must already be issued by then.
    expect(firstResolutionSaw).toBe(3);
  });

  it("disambiguates two same-named methods on different classes in one file via qualified node_keys, with no @Lline suffix needed (GRPH-006)", async () => {
    // ClassA.handle (line 1) and ClassB.handle (line 4) in a.ts -- same method name, same file,
    // different classes. Before GRPH-006 both would silently collapse onto the bare "a.ts#handle"
    // key and need line-suffix disambiguation (2026-07 CLI benchmark finding: an edge attaches to
    // the wrong symbol, or gets dropped as a false "duplicate"). TS's `supportsQualifiedContainment:
    // true` now qualifies each method's node_key with its enclosing class, so the two no longer
    // collide at all -- proving this ADR's exact fix end-to-end on the LSP side. Also proves the
    // memoization fix: "caller" in b.ts is looked up twice (once per reference) and must resolve to
    // the *same* key both times, not drift onto "b.ts#caller@L0" the second time around.
    const aUri = uriFor(workspaceRoot, "a.ts");
    const bUri = uriFor(workspaceRoot, "b.ts");
    const classAHandleSelection = range(1, 4, 1, 10);
    const classBHandleSelection = range(4, 4, 4, 10);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "ClassA",
              kind: LspSymbolKinds.CLASS,
              range: range(0, 0, 2, 1),
              selectionRange: range(0, 6, 0, 12),
              children: [
                {
                  name: "handle",
                  kind: LspSymbolKinds.METHOD,
                  range: range(1, 2, 1, 20),
                  selectionRange: classAHandleSelection,
                },
              ],
            },
            {
              name: "ClassB",
              kind: LspSymbolKinds.CLASS,
              range: range(3, 0, 5, 1),
              selectionRange: range(3, 6, 3, 12),
              children: [
                {
                  name: "handle",
                  kind: LspSymbolKinds.METHOD,
                  range: range(4, 2, 4, 20),
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
            selectionRange: range(0, 9, 0, 15),
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

    const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
      asClient(new FakeLspClient(handler)),
    );

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts", "b.ts"],
    });

    expect(outcome.edges).toEqual(
      expect.arrayContaining([
        {
          sourceNodeKey: "b.ts#caller",
          targetNodeKey: "a.ts#ClassA.handle",
          source: "lsp",
        },
        {
          sourceNodeKey: "b.ts#caller",
          targetNodeKey: "a.ts#ClassB.handle",
          source: "lsp",
        },
      ]),
    );
    expect(outcome.edges).toHaveLength(2);
  });

  it("assigns the bare key by line position, not by which symbol the documentSymbol response happens to list first", async () => {
    // Two top-level (no enclosing class) "run" functions -- deliberately NOT methods on two
    // different classes (GRPH-006 qualifies those with their container name, so they'd no longer
    // collide at all and this test's own premise, a still-colliding bare name, would be moot). The
    // later one (line 5) is listed BEFORE the earlier one (line 1) in documentSymbol's own array --
    // an LSP server isn't spec-required to return top-level symbols in source order, and even if
    // it usually does, this shouldn't matter: Tier A's own functions[] is genuinely line-ordered
    // (a tree-sitter source-order walk), so the bare key must go to whichever "run" sits at the
    // *lower* line number, regardless of the documentSymbol array's own order -- that's what the
    // line-sorted pre-pass in resolveNodeKeyForFile exists for.
    const aUri = uriFor(workspaceRoot, "a.ts");
    const bUri = uriFor(workspaceRoot, "b.ts");
    const laterRunSelection = range(5, 4, 5, 7);
    const earlierRunSelection = range(1, 4, 1, 7);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "run",
              kind: LspSymbolKinds.FUNCTION,
              range: range(4, 0, 6, 1),
              selectionRange: laterRunSelection,
            },
            {
              name: "run",
              kind: LspSymbolKinds.FUNCTION,
              range: range(0, 0, 2, 1),
              selectionRange: earlierRunSelection,
            },
          ];
        }
        return [
          {
            name: "caller",
            kind: LspSymbolKinds.FUNCTION,
            range: range(0, 0, 3, 1),
            selectionRange: range(0, 9, 0, 15),
          },
        ];
      }
      if (method === LspMethods.REFERENCES) {
        if (params.textDocument.uri === aUri) {
          if (params.position.line === laterRunSelection.start.line) {
            return [{ uri: bUri, range: range(1, 2, 1, 8) }];
          }
          if (params.position.line === earlierRunSelection.start.line) {
            return [{ uri: bUri, range: range(2, 2, 2, 8) }];
          }
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

    expect(outcome.edges).toEqual(
      expect.arrayContaining([
        // ClassEarlier.run sits at line 1 -- the lower line -- so it gets the bare key even
        // though ClassLater.run was listed first in documentSymbol's own array.
        {
          sourceNodeKey: "b.ts#caller",
          targetNodeKey: "a.ts#run",
          source: "lsp",
        },
        {
          sourceNodeKey: "b.ts#caller",
          targetNodeKey: "a.ts#run@L5",
          source: "lsp",
        },
      ]),
    );
    expect(outcome.edges).toHaveLength(2);
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

  it("degrades honestly on a whole-batch timeout, stops the client, and reports the file that was in flight as failed", async () => {
    let stopped = false;
    const hangingClient: LspJsonRpcClient = {
      start: vi.fn().mockResolvedValue(undefined),
      // initialize() and shutdown() resolve immediately (a real server that's wedged on one
      // request still typically answers control messages like shutdown); documentSymbol/
      // references hang forever -- only `raceAgainstDeadline`'s own per-file timer can ever
      // settle those, so this deterministically exercises that logic rather than racing it
      // against some other timeout the mock might also simulate.
      request: vi.fn().mockImplementation((method: string) => {
        if (
          method === LspMethods.INITIALIZE ||
          method === LspMethods.SHUTDOWN
        ) {
          return Promise.resolve({});
        }
        return new Promise(() => {});
      }),
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
    expect(outcome.filesProcessed).toEqual([]);
    expect(outcome.filesFailed).toEqual([
      {
        file: "a.ts",
        reason: expect.stringMatching(/exceeded its 20ms timeout/),
      },
    ]);
    expect(outcome.unavailableReason).toMatch(/exceeded its 20ms timeout/);
    expect(stopped).toBe(true);
  });

  it("preserves edges and filesProcessed from files completed before a whole-batch timeout, only reporting the unreached file as failed", async () => {
    let stopped = false;
    const client: LspJsonRpcClient = {
      start: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockImplementation((method: string, params: any) => {
        if (
          method === LspMethods.INITIALIZE ||
          method === LspMethods.SHUTDOWN
        ) {
          return Promise.resolve({});
        }
        if (method === LspMethods.DOCUMENT_SYMBOL) {
          // "a.ts" resolves fast (genuinely completes before the deadline); "b.ts" never
          // resolves (still in flight when the deadline trips -- caught by
          // raceAgainstDeadline, not this mock).
          const uri = params?.textDocument?.uri as string;
          if (uri?.endsWith("a.ts")) {
            return Promise.resolve([
              {
                name: "foo",
                kind: LspSymbolKinds.FUNCTION,
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 20 },
                },
                selectionRange: {
                  start: { line: 0, character: 9 },
                  end: { line: 0, character: 12 },
                },
              },
            ]);
          }
          return new Promise(() => {});
        }
        if (method === LspMethods.REFERENCES) return Promise.resolve([]);
        return Promise.resolve(null);
      }),
      notify: vi.fn(),
      stop: vi.fn().mockImplementation(async () => {
        stopped = true;
      }),
    } as unknown as LspJsonRpcClient;

    const provider = new TypescriptLspEdgeProvider(
      createMockLogger(),
      () => client,
    );
    provider.configure({ timeoutMs: 150 });

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts", "b.ts"],
    });

    expect(outcome.filesProcessed).toEqual(["a.ts"]);
    expect(outcome.filesFailed).toEqual([
      {
        file: "b.ts",
        reason: expect.stringMatching(/exceeded its 150ms timeout/),
      },
    ]);
    expect(outcome.unavailableReason).toMatch(/exceeded its 150ms timeout/);
    expect(stopped).toBe(true);
  });

  it("never enforces a whole-batch timeout when configured with timeoutMs: 0", async () => {
    // initialize() resolves after a short delay -- long enough that the "20ms timeout" test
    // above would have degraded, proving that timeoutMs: 0 really disables the race rather than
    // just using a very large number.
    const delayedClient: LspJsonRpcClient = {
      start: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockImplementation((method: string) => {
        if (method === LspMethods.INITIALIZE) {
          return new Promise((resolve) =>
            setTimeout(() => resolve({ capabilities: {} }), 30),
          );
        }
        if (method === LspMethods.DOCUMENT_SYMBOL) return Promise.resolve([]);
        return Promise.resolve(null);
      }),
      notify: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as LspJsonRpcClient;

    const provider = new TypescriptLspEdgeProvider(
      createMockLogger(),
      () => delayedClient,
    );
    provider.configure({ timeoutMs: 0 });

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["a.ts"],
    });

    expect(outcome.unavailableReason).toBeUndefined();
    expect(outcome.filesProcessed).toEqual(["a.ts"]);
  });

  it("passes the configured timeoutMs (not the 30s default) as every per-request timeout", async () => {
    const requestSpy = vi.fn().mockImplementation((method: string) => {
      if (method === LspMethods.INITIALIZE)
        return Promise.resolve({ capabilities: {} });
      if (method === LspMethods.DOCUMENT_SYMBOL) return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const client: LspJsonRpcClient = {
      start: vi.fn().mockResolvedValue(undefined),
      request: requestSpy,
      notify: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as LspJsonRpcClient;

    const provider = new TypescriptLspEdgeProvider(
      createMockLogger(),
      () => client,
    );
    provider.configure({ timeoutMs: 999_999 });

    await provider.resolveEdges({ workspaceRoot, files: ["a.ts"] });

    expect(requestSpy).toHaveBeenCalledWith(
      LspMethods.INITIALIZE,
      expect.anything(),
      999_999,
    );
    expect(requestSpy).toHaveBeenCalledWith(
      LspMethods.DOCUMENT_SYMBOL,
      expect.anything(),
      999_999,
    );
    expect(requestSpy).toHaveBeenCalledWith(LspMethods.SHUTDOWN, null, 999_999);
  });

  it("declares hierarchicalDocumentSymbolSupport on initialize (base-class behavior, BaseLspEdgeProvider.initializeSession) -- without it, a spec-compliant server like gopls answers documentSymbol with the flat SymbolInformation shape and every references lookup at that position fails (go-cli-benchmark.md §3.1)", async () => {
    const requestSpy = vi.fn().mockImplementation((method: string) => {
      if (method === LspMethods.INITIALIZE)
        return Promise.resolve({ capabilities: {} });
      if (method === LspMethods.DOCUMENT_SYMBOL) return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const client: LspJsonRpcClient = {
      start: vi.fn().mockResolvedValue(undefined),
      request: requestSpy,
      notify: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as LspJsonRpcClient;

    const provider = new TypescriptLspEdgeProvider(
      createMockLogger(),
      () => client,
    );

    await provider.resolveEdges({ workspaceRoot, files: ["a.ts"] });

    expect(requestSpy).toHaveBeenCalledWith(
      LspMethods.INITIALIZE,
      expect.objectContaining({
        capabilities: expect.objectContaining({
          textDocument: expect.objectContaining({
            documentSymbol: expect.objectContaining({
              hierarchicalDocumentSymbolSupport: true,
            }),
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it("sends maxTsServerMemory via initializationOptions on initialize (roadmap item 28) -- the mechanism typescript-language-server actually reads to raise tsserver's own --max-old-space-size, confirmed against a real tsserver OOM abort (exit 134) on a vscode-scale batch", async () => {
    const requestSpy = vi.fn().mockImplementation((method: string) => {
      if (method === LspMethods.INITIALIZE)
        return Promise.resolve({ capabilities: {} });
      if (method === LspMethods.DOCUMENT_SYMBOL) return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const client: LspJsonRpcClient = {
      start: vi.fn().mockResolvedValue(undefined),
      request: requestSpy,
      notify: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as LspJsonRpcClient;

    const provider = new TypescriptLspEdgeProvider(
      createMockLogger(),
      () => client,
    );

    await provider.resolveEdges({ workspaceRoot, files: ["a.ts"] });

    expect(requestSpy).toHaveBeenCalledWith(
      LspMethods.INITIALIZE,
      expect.objectContaining({
        initializationOptions: { maxTsServerMemory: 8192 },
      }),
      expect.anything(),
    );
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
      await rmSyncRetrying(dir);
    }
  }, 15000);
});
