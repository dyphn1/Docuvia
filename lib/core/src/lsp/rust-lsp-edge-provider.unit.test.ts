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
    const provider = new RustLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

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
          targetNodeKey: "a.rs#hello",
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
    const provider = new RustLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    await provider.resolveEdges({ workspaceRoot, files: ["main.rs"] });

    const didOpen = fake.notifications.find(
      (n) => n.method === LspMethods.DID_OPEN,
    );
    expect((didOpen?.params as any).textDocument.languageId).toBe("rust");
  });
});
