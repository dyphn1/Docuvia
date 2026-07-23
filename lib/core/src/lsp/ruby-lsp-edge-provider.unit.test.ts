import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLogger } from "@workspace/contracts";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { RubyLspEdgeProvider } from "./ruby-lsp-edge-provider.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-rubylsp-test-"));
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

describe("RubyLspEdgeProvider.resolveEdges()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeWorkspace({
      "main.rb": "class Foo; end\n",
    });
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns an empty outcome without touching the client factory when files is empty", async () => {
    const clientFactory = vi.fn();
    const provider = new RubyLspEdgeProvider(createMockLogger(), clientFactory);

    const outcome = await provider.resolveEdges({ workspaceRoot, files: [] });

    expect(outcome).toEqual({ edges: [], filesProcessed: [], filesFailed: [] });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("resolves a cross-file symbol-level calls edge via documentSymbol + references (Ruby)", async () => {
    const customWorkspace = makeWorkspace({
      "a.rb": "class A\n  def foo\n  end\nend\n",
      "b.rb":
        "require_relative 'a'\nclass B\n  def bar\n    a = A.new\n    a.foo\n  end\nend\n",
    });
    const aUri = uriFor(customWorkspace, "a.rb");
    const bUri = uriFor(customWorkspace, "b.rb");

    const fooSelectionRange = range(1, 6, 1, 9);
    const barSelectionRange = range(2, 6, 2, 9);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "A",
              kind: LspSymbolKinds.CLASS,
              range: range(0, 0, 3, 3),
              selectionRange: range(0, 6, 0, 7),
              children: [
                {
                  name: "foo",
                  kind: LspSymbolKinds.METHOD,
                  range: range(1, 2, 2, 5),
                  selectionRange: fooSelectionRange,
                },
              ],
            },
          ];
        }
        if (params.textDocument.uri === bUri) {
          return [
            {
              name: "B",
              kind: LspSymbolKinds.CLASS,
              range: range(1, 0, 6, 3),
              selectionRange: range(1, 6, 1, 7),
              children: [
                {
                  name: "bar",
                  kind: LspSymbolKinds.METHOD,
                  range: range(2, 2, 5, 5),
                  selectionRange: barSelectionRange,
                },
              ],
            },
          ];
        }
        return [];
      }
      if (method === LspMethods.REFERENCES) {
        if (
          params.textDocument.uri === aUri &&
          params.position.line === fooSelectionRange.start.line &&
          params.position.character === fooSelectionRange.start.character
        ) {
          return [{ uri: bUri, range: range(4, 6, 4, 9) }];
        }
        return [];
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const fake = new FakeLspClient(handler);
    const provider = new RubyLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    try {
      const outcome = await provider.resolveEdges({
        workspaceRoot: customWorkspace,
        files: ["a.rb", "b.rb"],
      });

      expect(outcome.filesFailed).toEqual([]);
      expect(outcome.filesProcessed).toEqual(["a.rb", "b.rb"]);
      expect(outcome.edges).toEqual([
        {
          sourceNodeKey: "b.rb#bar",
          targetNodeKey: "a.rb#foo",
          source: "lsp",
        },
      ]);
    } finally {
      fs.rmSync(customWorkspace, { recursive: true, force: true });
    }
  });

  it("opens each file with the correct languageId based on extension", async () => {
    const handler: RequestHandler = (method) => {
      if (method === LspMethods.DOCUMENT_SYMBOL) return [];
      return undefined;
    };
    const fake = new FakeLspClient(handler);
    const provider = new RubyLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    await provider.resolveEdges({ workspaceRoot, files: ["main.rb"] });

    const didOpen = fake.notifications.find(
      (n) => n.method === LspMethods.DID_OPEN,
    );
    expect((didOpen?.params as any).textDocument.languageId).toBe("ruby");
  });
});
