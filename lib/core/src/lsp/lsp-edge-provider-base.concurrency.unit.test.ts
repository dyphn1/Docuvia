import { describe, it, expect, vi } from "vitest";
import { createMockLogger } from "@workspace/contracts";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { TypescriptLspEdgeProvider } from "./typescript-lsp-edge-provider.js";
import { LspMethods, LspSymbolKinds } from "./lsp-constants.js";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";

type RequestHandler = (method: string, params: any) => unknown;

class FakeLspClient {
  public notifications: { method: string; params: unknown }[] = [];
  public started = false;
  public stopped = false;
  public startError: Error | undefined;
  public maxInFlight = 0;
  private inFlight = 0;

  constructor(
    private readonly handler: RequestHandler = () => undefined,
    private readonly latencyMs: (method: string, params: any) => number = () =>
      0,
  ) {}

  async start(): Promise<void> {
    if (this.startError) throw this.startError;
    this.started = true;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const delay = this.latencyMs(method, params);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      return this.handler(method, params) as T;
    } finally {
      this.inFlight--;
    }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-lsp-conc-test-"));
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

describe("BaseLspEdgeProvider K-way concurrency (Tier B K-way concurrency plan, issue #11 plan A)", () => {
  describe("K-invariance (keystone)", () => {
    it("produces identical edges/filesProcessed/filesFailed at maxConcurrentFiles: 1 vs 4", async () => {
      const workspaceRoot = makeWorkspace({
        "a.ts": "class ClassA { handle() {} }\nclass ClassB { handle() {} }\n",
        "b.ts": "function caller() {}\n",
        "c.ts": "function foo() {}\n",
        "d.ts": "function bar() { foo(); }\n",
        // Genuine same-file collision (unqualified -- no enclosing class, unlike a.ts's
        // ClassA.handle/ClassB.handle, which get *qualified* base keys via
        // `buildQualifiedBaseKey` and never collide at all): two top-level "dup" functions in
        // one file exercise `buildUniqueNodeKey`'s `@Lline` suffix branch, which the rest of this
        // fixture never reaches (cross-file same-name symbols can't collide by construction --
        // `resolveNodeKeyForFile`'s disambiguation state and base key are both per-file).
        "e.ts": "function dup() {}\n\n\nfunction dup() {}\n",
      });
      try {
        const aUri = uriFor(workspaceRoot, "a.ts");
        const bUri = uriFor(workspaceRoot, "b.ts");
        const cUri = uriFor(workspaceRoot, "c.ts");
        const dUri = uriFor(workspaceRoot, "d.ts");
        const eUri = uriFor(workspaceRoot, "e.ts");
        const classAHandleSelection = range(1, 4, 1, 10);
        const classBHandleSelection = range(4, 4, 4, 10);
        const fooSelection = range(0, 16, 0, 19);
        const barSelection = range(0, 16, 0, 19);
        const callerSelection = range(0, 9, 0, 15);
        const dup1Selection = range(0, 9, 0, 12);
        const dup2Selection = range(3, 9, 3, 12);

        const documentSymbolFor = (uri: string) => {
          if (uri === aUri) {
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
          if (uri === bUri) {
            return [
              {
                name: "caller",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 3, 1),
                selectionRange: callerSelection,
              },
            ];
          }
          if (uri === cUri) {
            return [
              {
                name: "foo",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 0, 25),
                selectionRange: fooSelection,
              },
            ];
          }
          if (uri === dUri) {
            return [
              {
                name: "bar",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 0, 25),
                selectionRange: barSelection,
              },
            ];
          }
          if (uri === eUri) {
            return [
              {
                name: "dup",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 0, 18),
                selectionRange: dup1Selection,
              },
              {
                name: "dup",
                kind: LspSymbolKinds.FUNCTION,
                range: range(3, 0, 3, 18),
                selectionRange: dup2Selection,
              },
            ];
          }
          return [];
        };

        const referencesFor = (uri: string, positionLine: number) => {
          if (uri === aUri) {
            if (positionLine === classAHandleSelection.start.line) {
              return [{ uri: bUri, range: range(1, 2, 1, 8) }];
            }
            if (positionLine === classBHandleSelection.start.line) {
              return [{ uri: bUri, range: range(2, 2, 2, 8) }];
            }
            return [];
          }
          if (uri === cUri) {
            return [{ uri: dUri, range: range(1, 2, 1, 5) }];
          }
          if (uri === eUri) {
            // Both "dup" overloads are referenced from b.ts, deliberately at a position outside
            // b.ts's own "caller" symbol range -- the source key falls back to the file-level
            // "b.ts" (an already-covered, unrelated path); what this exercises is e.ts's own
            // *target* key, one bare and one @Lline-suffixed.
            if (positionLine === dup1Selection.start.line) {
              return [{ uri: bUri, range: range(10, 0, 10, 3) }];
            }
            if (positionLine === dup2Selection.start.line) {
              return [{ uri: bUri, range: range(11, 0, 11, 3) }];
            }
            return [];
          }
          return [];
        };

        const handler: RequestHandler = (method, params) => {
          if (method === LspMethods.INITIALIZE) return {};
          if (method === LspMethods.DOCUMENT_SYMBOL) {
            return documentSymbolFor(params.textDocument.uri);
          }
          if (method === LspMethods.REFERENCES) {
            return referencesFor(params.textDocument.uri, params.position.line);
          }
          if (method === LspMethods.SHUTDOWN) return null;
          return undefined;
        };

        const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];

        const runAt = async (maxConcurrentFiles: number) => {
          const provider = new TypescriptLspEdgeProvider(
            createMockLogger(),
            () => asClient(new FakeLspClient(handler)),
          );
          provider.configure({ maxConcurrentFiles });
          return provider.resolveEdges({ workspaceRoot, files });
        };

        const k1 = await runAt(1);
        const k4 = await runAt(4);

        const sortEdges = (edges: typeof k1.edges) =>
          [...edges].sort((a, b) =>
            (a.sourceNodeKey + "->" + a.targetNodeKey).localeCompare(
              b.sourceNodeKey + "->" + b.targetNodeKey,
            ),
          );

        expect(k1.filesFailed).toEqual([]);
        expect(k4.filesFailed).toEqual([]);
        expect(sortEdges(k4.edges)).toEqual(sortEdges(k1.edges));
        expect([...k4.filesProcessed].sort()).toEqual(
          [...k1.filesProcessed].sort(),
        );
        expect(k4).toEqual(k1);

        // The suffix-disambiguation canary (buildUniqueNodeKey's `@Lline` branch): both edges
        // out of e.ts's two colliding "dup" symbols must be present, identical at both K, with
        // one bare and one suffixed key -- not deduped away, not both bare.
        expect(sortEdges(k1.edges)).toEqual(
          expect.arrayContaining([
            { sourceNodeKey: "b.ts", targetNodeKey: "e.ts#dup", source: "lsp" },
            {
              sourceNodeKey: "b.ts",
              targetNodeKey: "e.ts#dup@L3",
              source: "lsp",
            },
          ]),
        );
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  });

  describe("Overlap proof", () => {
    it(
      "processes 8 files measurably faster at maxConcurrentFiles: 4 than at the K=1 default, with real overlap observed",
      async () => {
        const fileNames = Array.from({ length: 8 }, (_, i) => "f" + i + ".ts");
        const workspaceRoot = makeWorkspace(
          Object.fromEntries(fileNames.map((f) => [f, "// no symbols\n"])),
        );
        try {
          const handler: RequestHandler = (method) => {
            if (method === LspMethods.INITIALIZE) return {};
            if (method === LspMethods.DOCUMENT_SYMBOL) return [];
            if (method === LspMethods.SHUTDOWN) return null;
            return undefined;
          };
          const latencyMs = (method: string) =>
            method === LspMethods.DOCUMENT_SYMBOL ? 20 : 0;

          const runAt = async (maxConcurrentFiles: number) => {
            const fake = new FakeLspClient(handler, latencyMs);
            const provider = new TypescriptLspEdgeProvider(
              createMockLogger(),
              () => asClient(fake),
            );
            provider.configure({ maxConcurrentFiles });
            const start = Date.now();
            const outcome = await provider.resolveEdges({
              workspaceRoot,
              files: fileNames,
            });
            return { outcome, fake, elapsedMs: Date.now() - start };
          };

          const k1 = await runAt(1);
          const k4 = await runAt(4);

          expect(k1.outcome.filesFailed).toEqual([]);
          expect(k4.outcome.filesFailed).toEqual([]);
          expect(k4.fake.maxInFlight).toBeGreaterThan(1);
          expect(k4.elapsedMs).toBeLessThan(k1.elapsedMs * 0.7);
        } finally {
          fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
      },
      SUBPROCESS_TEST_TIMEOUT_MS,
    );
  });

  describe("Stampede (Phase 3, D5)", () => {
    it("issues exactly one DID_OPEN for a not-yet-opened target file even when two concurrent turns both need it", async () => {
      const workspaceRoot = makeWorkspace({
        "a.ts": "function foo() {}\n",
        "b.ts": "function bar() {}\n",
        "c.ts": "// caller of both foo and bar\n",
      });
      try {
        const aUri = uriFor(workspaceRoot, "a.ts");
        const bUri = uriFor(workspaceRoot, "b.ts");
        const cUri = uriFor(workspaceRoot, "c.ts");
        const fooSelection = range(0, 9, 0, 12);
        const barSelection = range(0, 9, 0, 12);

        const handler: RequestHandler = (method, params) => {
          if (method === LspMethods.INITIALIZE) return {};
          if (method === LspMethods.DOCUMENT_SYMBOL) {
            const uri = params.textDocument.uri;
            if (uri === aUri) {
              return [
                {
                  name: "foo",
                  kind: LspSymbolKinds.FUNCTION,
                  range: range(0, 0, 0, 19),
                  selectionRange: fooSelection,
                },
              ];
            }
            if (uri === bUri) {
              return [
                {
                  name: "bar",
                  kind: LspSymbolKinds.FUNCTION,
                  range: range(0, 0, 0, 19),
                  selectionRange: barSelection,
                },
              ];
            }
            return [];
          }
          if (method === LspMethods.REFERENCES) {
            const uri = params.textDocument.uri;
            if (uri === aUri) return [{ uri: cUri, range: range(0, 0, 0, 3) }];
            if (uri === bUri) return [{ uri: cUri, range: range(1, 0, 1, 3) }];
            return [];
          }
          if (method === LspMethods.SHUTDOWN) return null;
          return undefined;
        };

        const fake = new FakeLspClient(handler);
        const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
          asClient(fake),
        );
        provider.configure({ maxConcurrentFiles: 2 });

        const outcome = await provider.resolveEdges({
          workspaceRoot,
          files: ["a.ts", "b.ts"],
        });

        expect(outcome.filesFailed).toEqual([]);
        const cOpens = fake.notifications.filter(
          (n) =>
            n.method === LspMethods.DID_OPEN &&
            (n.params as any).textDocument.uri === cUri,
        );
        expect(cOpens).toHaveLength(1);
        expect(outcome.edges).toEqual(
          expect.arrayContaining([
            { sourceNodeKey: "c.ts", targetNodeKey: "a.ts#foo", source: "lsp" },
            { sourceNodeKey: "c.ts", targetNodeKey: "b.ts#bar", source: "lsp" },
          ]),
        );
        expect(outcome.edges).toHaveLength(2);
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  });

  describe("In-flight-aware cap (Phase 3, D6)", () => {
    it(
      "never lets the LSP server hold more than maxOpenFiles documents open at once, even while concurrent target opens are still in flight (not yet settled)",
      async () => {
        const workspaceRoot = makeWorkspace({
          "fileA.ts": "function fnA1(){} function fnA2(){}\n",
          "fileB.ts": "function fnB1(){} function fnB2(){}\n",
          "targetA1.ts": "// target A1\n",
          "targetA2.ts": "// target A2\n",
          "targetB1.ts": "// target B1\n",
          "targetB2.ts": "// target B2\n",
        });
        try {
          const uris = {
            fileA: uriFor(workspaceRoot, "fileA.ts"),
            fileB: uriFor(workspaceRoot, "fileB.ts"),
            targetA1: uriFor(workspaceRoot, "targetA1.ts"),
            targetA2: uriFor(workspaceRoot, "targetA2.ts"),
            targetB1: uriFor(workspaceRoot, "targetB1.ts"),
            targetB2: uriFor(workspaceRoot, "targetB2.ts"),
          };
          const fnA1Sel = range(0, 9, 0, 13);
          const fnA2Sel = range(0, 28, 0, 32);
          const fnB1Sel = range(0, 9, 0, 13);
          const fnB2Sel = range(0, 28, 0, 32);

          const documentSymbolFor = (uri: string) => {
            if (uri === uris.fileA) {
              return [
                {
                  name: "fnA1",
                  kind: LspSymbolKinds.FUNCTION,
                  range: range(0, 0, 0, 18),
                  selectionRange: fnA1Sel,
                },
                {
                  name: "fnA2",
                  kind: LspSymbolKinds.FUNCTION,
                  range: range(0, 19, 0, 37),
                  selectionRange: fnA2Sel,
                },
              ];
            }
            if (uri === uris.fileB) {
              return [
                {
                  name: "fnB1",
                  kind: LspSymbolKinds.FUNCTION,
                  range: range(0, 0, 0, 18),
                  selectionRange: fnB1Sel,
                },
                {
                  name: "fnB2",
                  kind: LspSymbolKinds.FUNCTION,
                  range: range(0, 19, 0, 37),
                  selectionRange: fnB2Sel,
                },
              ];
            }
            return [];
          };

          const referencesFor = (
            uri: string,
            position: { line: number; character: number },
          ) => {
            if (uri === uris.fileA) {
              if (
                position.line === fnA1Sel.start.line &&
                position.character === fnA1Sel.start.character
              ) {
                return [{ uri: uris.targetA1, range: range(0, 0, 0, 3) }];
              }
              return [{ uri: uris.targetA2, range: range(0, 0, 0, 3) }];
            }
            if (uri === uris.fileB) {
              if (
                position.line === fnB1Sel.start.line &&
                position.character === fnB1Sel.start.character
              ) {
                return [{ uri: uris.targetB1, range: range(0, 0, 0, 3) }];
              }
              return [{ uri: uris.targetB2, range: range(0, 0, 0, 3) }];
            }
            return [];
          };

          const handler: RequestHandler = (method, params) => {
            if (method === LspMethods.INITIALIZE) return {};
            if (method === LspMethods.DOCUMENT_SYMBOL) {
              return documentSymbolFor(params.textDocument.uri);
            }
            if (method === LspMethods.REFERENCES) {
              return referencesFor(params.textDocument.uri, params.position);
            }
            if (method === LspMethods.SHUTDOWN) return null;
            return undefined;
          };
          const latencyMs = (method: string) =>
            method === LspMethods.DOCUMENT_SYMBOL ||
            method === LspMethods.REFERENCES
              ? 15
              : 0;

          const fake = new FakeLspClient(handler, latencyMs);
          const provider = new TypescriptLspEdgeProvider(
            createMockLogger(),
            () => asClient(fake),
          );
          provider.configure({ maxOpenFiles: 5, maxConcurrentFiles: 2 });

          const outcome = await provider.resolveEdges({
            workspaceRoot,
            files: ["fileA.ts", "fileB.ts"],
          });

          expect(outcome.filesFailed).toEqual([]);

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

          expect(maxConcurrentlyOpen).toBeLessThanOrEqual(5);
        } finally {
          fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
      },
      SUBPROCESS_TEST_TIMEOUT_MS,
    );
  });

  describe("Pinning (Phase 4, D7)", () => {
    it(
      "never re-opens a worker's own file mid-turn, even under heavy eviction pressure from its own 5-target fan-out",
      async () => {
        const targetNames = Array.from(
          { length: 5 },
          (_, i) => "T" + i + ".ts",
        );
        const workspaceRoot = makeWorkspace({
          "A.ts": "// 5 call sites\n",
          "B.ts": "// 1 call site\n",
          ...Object.fromEntries(targetNames.map((t) => [t, "// target\n"])),
        });
        try {
          const aUri = uriFor(workspaceRoot, "A.ts");
          const bUri = uriFor(workspaceRoot, "B.ts");
          const targetUris = targetNames.map((t) => uriFor(workspaceRoot, t));
          const aSymbolSelections = Array.from({ length: 5 }, (_, i) =>
            range(0, i * 4, 0, i * 4 + 2),
          );
          const bSymbolSelection = range(0, 0, 0, 2);

          const handler: RequestHandler = (method, params) => {
            if (method === LspMethods.INITIALIZE) return {};
            if (method === LspMethods.DOCUMENT_SYMBOL) {
              const uri = params.textDocument.uri;
              if (uri === aUri) {
                return aSymbolSelections.map((sel, i) => ({
                  name: "s" + i,
                  kind: LspSymbolKinds.FUNCTION,
                  range: range(
                    0,
                    sel.start.character,
                    0,
                    sel.start.character + 2,
                  ),
                  selectionRange: sel,
                }));
              }
              if (uri === bUri) {
                return [
                  {
                    name: "sb",
                    kind: LspSymbolKinds.FUNCTION,
                    range: range(0, 0, 0, 2),
                    selectionRange: bSymbolSelection,
                  },
                ];
              }
              return [];
            }
            if (method === LspMethods.REFERENCES) {
              const uri = params.textDocument.uri;
              if (uri === aUri) {
                const i = aSymbolSelections.findIndex(
                  (sel) => sel.start.character === params.position.character,
                );
                if (i >= 0) {
                  return [{ uri: targetUris[i], range: range(0, 0, 0, 3) }];
                }
                return [];
              }
              if (uri === bUri) {
                return [{ uri: targetUris[0], range: range(0, 0, 0, 3) }];
              }
              return [];
            }
            if (method === LspMethods.SHUTDOWN) return null;
            return undefined;
          };

          const fake = new FakeLspClient(handler);
          const provider = new TypescriptLspEdgeProvider(
            createMockLogger(),
            () => asClient(fake),
          );
          provider.configure({ maxOpenFiles: 2, maxConcurrentFiles: 2 });

          const outcome = await provider.resolveEdges({
            workspaceRoot,
            files: ["A.ts", "B.ts"],
          });

          expect(outcome.filesFailed).toEqual([]);
          expect(outcome.filesProcessed.slice().sort()).toEqual([
            "A.ts",
            "B.ts",
          ]);

          const aOpens = fake.notifications.filter(
            (n) =>
              n.method === LspMethods.DID_OPEN &&
              (n.params as any).textDocument.uri === aUri,
          );
          const bOpens = fake.notifications.filter(
            (n) =>
              n.method === LspMethods.DID_OPEN &&
              (n.params as any).textDocument.uri === bUri,
          );
          expect(aOpens).toHaveLength(1);
          expect(bOpens).toHaveLength(1);

          // The real D7 canary (aOpens/bOpens counts alone would pass identically even with
          // pinning deleted, since `processOneFileReverse` captures `callee.uri` locally once and
          // never re-touches the cache for its own file -- a premature eviction would just silently
          // no-op the later `closeAndEvict` lookup without changing the open count or dropping
          // edges). T4 (targetUris[4]) is only ever opened by A's own turn, serially last among its
          // 5 targets -- if A.ts's own cache entry were evicted at any point before then (the exact
          // hazard D7 exists to prevent), it would have to have been closed while still needed.
          const lastTargetOpenIndex = fake.notifications.findIndex(
            (n) =>
              n.method === LspMethods.DID_OPEN &&
              (n.params as any).textDocument.uri === targetUris[4],
          );
          expect(lastTargetOpenIndex).toBeGreaterThanOrEqual(0);
          const aCloseIndex = fake.notifications.findIndex(
            (n) =>
              n.method === LspMethods.DID_CLOSE &&
              (n.params as any).textDocument.uri === aUri,
          );
          expect(aCloseIndex === -1 || aCloseIndex > lastTargetOpenIndex).toBe(
            true,
          );

          expect(outcome.edges.length).toBeGreaterThanOrEqual(5);
        } finally {
          fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
      },
      SUBPROCESS_TEST_TIMEOUT_MS,
    );
  });

  describe("Deadline mid-flight, K>1 (Phase 6, D9)", () => {
    it("splits files correctly into failed-in-flight / failed-unreached, with no duplicates, when the deadline trips while K>1 workers are all hung", async () => {
      const workspaceRoot = makeWorkspace({
        "a.ts": "",
        "b.ts": "",
        "c.ts": "",
        "d.ts": "",
        "e.ts": "",
      });
      try {
        const hangingClient: LspJsonRpcClient = {
          start: vi.fn().mockResolvedValue(undefined),
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
          stop: vi.fn().mockResolvedValue(undefined),
        } as unknown as LspJsonRpcClient;

        const provider = new TypescriptLspEdgeProvider(
          createMockLogger(),
          () => hangingClient,
        );
        provider.configure({ timeoutMs: 30, maxConcurrentFiles: 3 });

        const outcome = await provider.resolveEdges({
          workspaceRoot,
          files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
        });

        expect(outcome.filesProcessed).toEqual([]);
        expect(outcome.filesFailed).toHaveLength(5);
        const failedFiles = outcome.filesFailed
          .map((f) => f.file)
          .slice()
          .sort();
        expect(failedFiles).toEqual(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);
        expect(new Set(failedFiles).size).toBe(5);
        for (const failure of outcome.filesFailed) {
          expect(failure.reason).toMatch(/exceeded its 30ms timeout/);
        }
        expect(outcome.unavailableReason).toMatch(/exceeded its 30ms timeout/);

        // Prove the 2 unreached files (d.ts/e.ts) were genuinely never claimed by a worker, not
        // just reported failed with the same reason as the 3 in-flight ones -- only 3 workers
        // (maxConcurrentFiles: 3) ever issue a DOCUMENT_SYMBOL request, one per claimed file.
        const documentSymbolCalls = (
          hangingClient.request as unknown as { mock: { calls: unknown[][] } }
        ).mock.calls.filter((call) => call[0] === LspMethods.DOCUMENT_SYMBOL);
        expect(documentSymbolCalls).toHaveLength(3);
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  });

  describe("Clamp (D4)", () => {
    it(
      "clamps maxConcurrentFiles to maxOpenFiles - 1 and logs once",
      async () => {
        const fileNames = Array.from({ length: 10 }, (_, i) => "f" + i + ".ts");
        const workspaceRoot = makeWorkspace(
          Object.fromEntries(fileNames.map((f) => [f, "// no symbols\n"])),
        );
        try {
          const handler: RequestHandler = (method) => {
            if (method === LspMethods.INITIALIZE) return {};
            if (method === LspMethods.DOCUMENT_SYMBOL) return [];
            if (method === LspMethods.SHUTDOWN) return null;
            return undefined;
          };
          const latencyMs = (method: string) =>
            method === LspMethods.DOCUMENT_SYMBOL ? 15 : 0;
          const fake = new FakeLspClient(handler, latencyMs);
          const logger = createMockLogger();
          const provider = new TypescriptLspEdgeProvider(logger, () =>
            asClient(fake),
          );
          provider.configure({ maxConcurrentFiles: 50, maxOpenFiles: 10 });

          const outcome = await provider.resolveEdges({
            workspaceRoot,
            files: fileNames,
          });

          expect(outcome.filesFailed).toEqual([]);
          // effectiveConcurrency = min(50, 10 files, maxOpenFiles(10) - 1) = 9 -- assert the bound
          // (never more than 9 concurrent file-level requests, proving the clamp held) and that
          // real overlap actually happened (not silently serialized). Not an exact-equality
          // assertion against 9: real `fs.readFile` I/O timing (unmocked) can occasionally let one
          // of the 9 initial requests settle before all 9 have registered, so the observed peak can
          // land anywhere in (1, 9] without indicating a bug.
          expect(fake.maxInFlight).toBeGreaterThan(1);
          expect(fake.maxInFlight).toBeLessThanOrEqual(9);

          const clampLogs = logger.events.filter(
            (e) => e.level === "debug" && e.message.includes("clamped"),
          );
          expect(clampLogs).toHaveLength(1);
          expect(clampLogs[0].message).toMatch(
            /maxConcurrentFiles=50 clamped to 9/,
          );
        } finally {
          fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
      },
      SUBPROCESS_TEST_TIMEOUT_MS,
    );
  });
});
