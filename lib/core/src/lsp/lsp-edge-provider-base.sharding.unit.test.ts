import { describe, it, expect, vi } from "vitest";
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

  constructor(
    private readonly handler: RequestHandler = () => undefined,
    private readonly id: number,
  ) {}

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-lsp-shard-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const absolute = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
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

describe("BaseLspEdgeProvider multi-process sharding (Tier B multi-process sharding plan)", () => {
  describe("process-invariance (keystone)", () => {
    it("produces identical edges/filesProcessed/filesFailed at maxProcesses: 1 vs 4 (reverse path)", async () => {
      const workspaceRoot = makeWorkspace({
        "a.ts": "class ClassA { handle() {} }\nclass ClassB { handle() {} }\n",
        "b.ts": "function caller() {}\n",
        "c.ts": "function foo() {}\n",
        "d.ts": "function bar() { foo(); }\n",
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
          if (uri === aUri)
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
          if (uri === bUri)
            return [
              {
                name: "caller",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 3, 1),
                selectionRange: callerSelection,
              },
            ];
          if (uri === cUri)
            return [
              {
                name: "foo",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 0, 25),
                selectionRange: fooSelection,
              },
            ];
          if (uri === dUri)
            return [
              {
                name: "bar",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 0, 25),
                selectionRange: barSelection,
              },
            ];
          if (uri === eUri)
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
          return [];
        };

        const referencesFor = (uri: string, positionLine: number) => {
          if (uri === aUri) {
            if (positionLine === classAHandleSelection.start.line)
              return [{ uri: bUri, range: range(1, 2, 1, 8) }];
            if (positionLine === classBHandleSelection.start.line)
              return [{ uri: bUri, range: range(2, 2, 2, 8) }];
            return [];
          }
          if (uri === cUri) return [{ uri: dUri, range: range(1, 2, 1, 5) }];
          if (uri === eUri) {
            if (positionLine === dup1Selection.start.line)
              return [{ uri: bUri, range: range(10, 0, 10, 3) }];
            if (positionLine === dup2Selection.start.line)
              return [{ uri: bUri, range: range(11, 0, 11, 3) }];
            return [];
          }
          return [];
        };

        const handler: RequestHandler = (method, params) => {
          if (method === LspMethods.INITIALIZE) return {};
          if (method === LspMethods.DOCUMENT_SYMBOL)
            return documentSymbolFor(params.textDocument.uri);
          if (method === LspMethods.REFERENCES)
            return referencesFor(params.textDocument.uri, params.position.line);
          if (method === LspMethods.SHUTDOWN) return null;
          return undefined;
        };

        const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];

        const runAt = async (maxProcesses: number) => {
          let clientSeq = 0;
          const provider = new TypescriptLspEdgeProvider(
            createMockLogger(),
            () => asClient(new FakeLspClient(handler, clientSeq++)),
          );
          provider.configure({ maxProcesses });
          const outcome = await provider.resolveEdges({ workspaceRoot, files });
          return { outcome, clients: clientSeq };
        };

        const p1 = await runAt(1);
        const p4 = await runAt(4);

        const sortEdges = (edges: typeof p1.outcome.edges) =>
          [...edges].sort((a, b) =>
            (a.sourceNodeKey + "->" + a.targetNodeKey).localeCompare(
              b.sourceNodeKey + "->" + b.targetNodeKey,
            ),
          );

        expect(p1.outcome.filesFailed).toEqual([]);
        expect(p4.outcome.filesFailed).toEqual([]);
        expect(sortEdges(p4.outcome.edges)).toEqual(
          sortEdges(p1.outcome.edges),
        );
        expect([...p4.outcome.filesProcessed].sort()).toEqual(
          [...p1.outcome.filesProcessed].sort(),
        );
        // filesProcessed/filesFailed are re-ordered to input order (byte parity with
        // single-process); edges are emitted sorted by key (multi-shard determinism).
        expect(p4.outcome.filesProcessed).toEqual(p1.outcome.filesProcessed);
        expect(p4.outcome.filesFailed).toEqual(p1.outcome.filesFailed);
        expect(p4.outcome.edges).toEqual(sortEdges(p1.outcome.edges));

        // Single-project bucket: even at maxProcesses: 4 the project-aware partition keeps every
        // file in ONE shard (PRJ-002 -- a project's files are never split across servers, and this
        // fixture is a single tsconfig/package.json project), so it spawns exactly one client.
        expect(p4.clients).toBe(1);
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it("spawns one server per owning project, pointed at the project root (PRJ-001/002)", async () => {
      const workspaceRoot = makeWorkspace({
        "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
        "packages/a/package.json": JSON.stringify({ name: "a" }),
        "packages/a/src/a.ts": "export function a() {}\n",
        "packages/b/package.json": JSON.stringify({ name: "b" }),
        "packages/b/src/b.ts": "export function b() {}\n",
      });
      try {
        const handler: RequestHandler = (method) => {
          if (method === LspMethods.INITIALIZE) return {};
          if (method === LspMethods.DOCUMENT_SYMBOL) return [];
          if (method === LspMethods.SHUTDOWN) return null;
          return undefined;
        };
        // Capture each spawned client's `initialize` rootUri so the test can assert the shard
        // server was pointed at its owning project, not the workspace root.
        const roots: string[] = [];
        const makeClient = (seq: number) =>
          asClient(
            new (class extends FakeLspClient {
              async request<T>(method: string, params: any): Promise<T> {
                if (method === LspMethods.INITIALIZE && params?.rootUri)
                  roots.push(params.rootUri);
                return handler(method, params) as T;
              }
            })(handler, seq),
          );

        let clientSeq = 0;
        const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
          makeClient(clientSeq++),
        );
        provider.configure({ maxProcesses: 4 });

        await provider.resolveEdges({
          workspaceRoot,
          files: ["packages/a/src/a.ts", "packages/b/src/b.ts"],
        });

        expect(roots).toHaveLength(2);
        expect(roots).toEqual(
          expect.arrayContaining([
            uriFor(workspaceRoot, "packages/a"),
            uriFor(workspaceRoot, "packages/b"),
          ]),
        );
        expect(roots).not.toContain(uriFor(workspaceRoot, ""));
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it("coalesces extra projects into a misc shard at the workspace root (PRJ-006)", async () => {
      const workspaceRoot = makeWorkspace({
        "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
        "packages/a/package.json": JSON.stringify({ name: "a" }),
        "packages/a/src/a.ts": "export function a() {}\n",
        "packages/b/package.json": JSON.stringify({ name: "b" }),
        "packages/b/src/b.ts": "export function b() {}\n",
        "packages/c/package.json": JSON.stringify({ name: "c" }),
        "packages/c/src/c.ts": "export function c() {}\n",
        "packages/d/package.json": JSON.stringify({ name: "d" }),
        "packages/d/src/d.ts": "export function d() {}\n",
      });
      try {
        const handler: RequestHandler = (method) => {
          if (method === LspMethods.INITIALIZE) return {};
          if (method === LspMethods.DOCUMENT_SYMBOL) return [];
          if (method === LspMethods.SHUTDOWN) return null;
          return undefined;
        };
        const roots: string[] = [];
        const makeClient = (seq: number) =>
          asClient(
            new (class extends FakeLspClient {
              async request<T>(method: string, params: any): Promise<T> {
                if (method === LspMethods.INITIALIZE && params?.rootUri)
                  roots.push(params.rootUri);
                return handler(method, params) as T;
              }
            })(handler, seq),
          );

        let clientSeq = 0;
        const provider = new TypescriptLspEdgeProvider(createMockLogger(), () =>
          makeClient(clientSeq++),
        );
        // 4 projects, budget for only 2 shards: the two largest projects keep their own servers,
        // the two smallest coalesce into one misc shard at the workspace root.
        provider.configure({ maxProcesses: 2 });

        const outcome = await provider.resolveEdges({
          workspaceRoot,
          files: [
            "packages/a/src/a.ts",
            "packages/b/src/b.ts",
            "packages/c/src/c.ts",
            "packages/d/src/d.ts",
          ],
        });

        expect(outcome.filesProcessed).toEqual([
          "packages/a/src/a.ts",
          "packages/b/src/b.ts",
          "packages/c/src/c.ts",
          "packages/d/src/d.ts",
        ]);
        // 2 shards total: one project server + one misc server at the workspace root.
        expect(roots).toHaveLength(2);
        expect(roots).toContain(uriFor(workspaceRoot, ""));
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it("preserves forward-path callsByFile seeds per shard (a file's seeds follow the file's shard)", async () => {
      const workspaceRoot = makeWorkspace({
        "caller-a.ts": "function callA() { target(); }\n",
        "caller-b.ts": "function callB() { target(); }\n",
        "target.ts": "export function target() {}\n",
      });
      try {
        const callerAUri = uriFor(workspaceRoot, "caller-a.ts");
        const callerBUri = uriFor(workspaceRoot, "caller-b.ts");
        const targetUri = uriFor(workspaceRoot, "target.ts");
        const targetSelection = range(0, 15, 0, 21);

        const documentSymbolFor = (uri: string) => {
          if (uri === callerAUri)
            return [
              {
                name: "callA",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 0, 30),
                selectionRange: range(0, 9, 0, 14),
              },
            ];
          if (uri === callerBUri)
            return [
              {
                name: "callB",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 0, 30),
                selectionRange: range(0, 9, 0, 14),
              },
            ];
          if (uri === targetUri)
            return [
              {
                name: "target",
                kind: LspSymbolKinds.FUNCTION,
                range: range(0, 0, 0, 25),
                selectionRange: targetSelection,
              },
            ];
          return [];
        };

        const handler: RequestHandler = (method, params) => {
          if (method === LspMethods.INITIALIZE) return {};
          if (method === LspMethods.DOCUMENT_SYMBOL)
            return documentSymbolFor(params.textDocument.uri);
          if (method === LspMethods.DEFINITION)
            return { uri: targetUri, range: targetSelection };
          if (method === LspMethods.SHUTDOWN) return null;
          return undefined;
        };

        const files = ["caller-a.ts", "caller-b.ts"];
        const callsByFile = {
          "caller-a.ts": [
            { targetFunction: "target", startLine: 0, startColumn: 16 },
          ],
          "caller-b.ts": [
            { targetFunction: "target", startLine: 0, startColumn: 16 },
          ],
        };

        const runAt = async (maxProcesses: number) => {
          const provider = new TypescriptLspEdgeProvider(
            createMockLogger(),
            () => asClient(new FakeLspClient(handler, 0)),
          );
          provider.configure({ maxProcesses });
          return provider.resolveEdges({ workspaceRoot, files, callsByFile });
        };

        const p1 = await runAt(1);
        const p2 = await runAt(2);

        expect(p2.filesFailed).toEqual([]);
        expect(p2.edges).toEqual(p1.edges);
        expect([...p2.filesProcessed].sort()).toEqual(
          [...p1.filesProcessed].sort(),
        );
        expect(p2.edges.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it("clamps maxProcesses to file count and logs once", async () => {
      const workspaceRoot = makeWorkspace({
        "a.ts": "export function a() {}\n",
        "b.ts": "export function b() {}\n",
      });
      try {
        const handler: RequestHandler = (method) => {
          if (method === LspMethods.INITIALIZE) return {};
          if (method === LspMethods.DOCUMENT_SYMBOL) return [];
          if (method === LspMethods.SHUTDOWN) return null;
          return undefined;
        };
        const logger = createMockLogger();
        let clientSeq = 0;
        const provider = new TypescriptLspEdgeProvider(logger, () =>
          asClient(new FakeLspClient(handler, clientSeq++)),
        );
        provider.configure({ maxProcesses: 50 });

        await provider.resolveEdges({
          workspaceRoot,
          files: ["a.ts", "b.ts"],
        });

        // effectiveProcesses = min(50, 2 files) = 2 -- assert the bound and the single log line.
        expect(clientSeq).toBeLessThanOrEqual(2);
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it("clamps maxProcesses by the memory budget (not just file count) and logs a memory-clamp line", async () => {
      const workspaceRoot = makeWorkspace({
        "a.ts": "export function a() {}\n",
        "b.ts": "export function b() {}\n",
        "c.ts": "export function c() {}\n",
        "d.ts": "export function d() {}\n",
        "e.ts": "export function e() {}\n",
      });
      try {
        const handler: RequestHandler = (method) => {
          if (method === LspMethods.INITIALIZE) return {};
          if (method === LspMethods.DOCUMENT_SYMBOL) return [];
          if (method === LspMethods.SHUTDOWN) return null;
          return undefined;
        };
        const logger = createMockLogger();
        let clientSeq = 0;
        const provider = new TypescriptLspEdgeProvider(logger, () =>
          asClient(new FakeLspClient(handler, clientSeq++)),
        );

        // 5 files, budget 1200MiB / estimate 512MiB => floor(1200/512) = 2 shards at most.
        provider.configure({
          maxProcesses: 5,
          maxProcessMemoryMb: 1200,
          processMemoryEstimateMb: 512,
        });

        await provider.resolveEdges({
          workspaceRoot,
          files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
        });

        // File count says 5, but memory bounds it to 2.
        expect(clientSeq).toBeLessThanOrEqual(2);
        expect(
          logger.events.some(
            (e) =>
              e.level === "debug" &&
              e.message.includes("clamped to 2 by memory"),
          ),
        ).toBe(true);
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });

    it("respects the memory budget and never spawns below one shard", async () => {
      const workspaceRoot = makeWorkspace({
        "a.ts": "export function a() {}\n",
      });
      try {
        const handler: RequestHandler = (method) => {
          if (method === LspMethods.INITIALIZE) return {};
          if (method === LspMethods.DOCUMENT_SYMBOL) return [];
          if (method === LspMethods.SHUTDOWN) return null;
          return undefined;
        };
        const logger = createMockLogger();
        let clientSeq = 0;
        const provider = new TypescriptLspEdgeProvider(logger, () =>
          asClient(new FakeLspClient(handler, clientSeq++)),
        );

        // Budget far smaller than one shard's estimate -- must still spawn exactly one.
        provider.configure({
          maxProcesses: 4,
          maxProcessMemoryMb: 1,
          processMemoryEstimateMb: 512,
        });

        await provider.resolveEdges({ workspaceRoot, files: ["a.ts"] });

        expect(clientSeq).toBe(1);
      } finally {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  });
});
