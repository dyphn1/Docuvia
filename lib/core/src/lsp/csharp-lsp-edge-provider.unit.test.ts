import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLogger } from "@workspace/contracts";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { CsharpLspEdgeProvider } from "./csharp-lsp-edge-provider.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-csharplsp-test-"));
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

describe("CsharpLspEdgeProvider.resolveEdges()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeWorkspace({
      "Program.cs": "class Program {}\n",
    });
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns an empty outcome without touching the client factory when files is empty", async () => {
    const clientFactory = vi.fn();
    const provider = new CsharpLspEdgeProvider(
      createMockLogger(),
      clientFactory,
    );

    const outcome = await provider.resolveEdges({ workspaceRoot, files: [] });

    expect(outcome).toEqual({ edges: [], filesProcessed: [], filesFailed: [] });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("resolves a cross-file symbol-level calls edge via documentSymbol + references (C#)", async () => {
    const customWorkspace = makeWorkspace({
      "A.cs":
        "namespace MyProject {\n    public class A {\n        public void Foo() {}\n    }\n}\n",
      "B.cs":
        "namespace MyProject {\n    public class B {\n        public void Bar() {\n            var a = new A();\n            a.Foo();\n        }\n    }\n}\n",
    });
    const aUri = uriFor(customWorkspace, "A.cs");
    const bUri = uriFor(customWorkspace, "B.cs");

    const fooSelectionRange = range(2, 20, 2, 23);
    const barSelectionRange = range(2, 20, 2, 23);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "MyProject",
              kind: LspSymbolKinds.NAMESPACE,
              range: range(0, 0, 5, 1),
              selectionRange: range(0, 10, 0, 19),
              children: [
                {
                  name: "A",
                  kind: LspSymbolKinds.CLASS,
                  range: range(1, 4, 4, 5),
                  selectionRange: range(1, 17, 1, 18),
                  children: [
                    {
                      name: "Foo",
                      kind: LspSymbolKinds.METHOD,
                      range: range(2, 8, 2, 28),
                      selectionRange: fooSelectionRange,
                    },
                  ],
                },
              ],
            },
          ];
        }
        if (params.textDocument.uri === bUri) {
          return [
            {
              name: "MyProject",
              kind: LspSymbolKinds.NAMESPACE,
              range: range(0, 0, 8, 1),
              selectionRange: range(0, 10, 0, 19),
              children: [
                {
                  name: "B",
                  kind: LspSymbolKinds.CLASS,
                  range: range(1, 4, 7, 5),
                  selectionRange: range(1, 17, 1, 18),
                  children: [
                    {
                      name: "Bar",
                      kind: LspSymbolKinds.METHOD,
                      range: range(2, 8, 6, 9),
                      selectionRange: barSelectionRange,
                    },
                  ],
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
          return [{ uri: bUri, range: range(4, 14, 4, 17) }];
        }
        return [];
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const fake = new FakeLspClient(handler);
    const provider = new CsharpLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    try {
      const outcome = await provider.resolveEdges({
        workspaceRoot: customWorkspace,
        files: ["A.cs", "B.cs"],
      });

      expect(outcome.filesFailed).toEqual([]);
      expect(outcome.filesProcessed).toEqual(["A.cs", "B.cs"]);
      expect(outcome.edges).toEqual([
        {
          sourceNodeKey: "B.cs#Bar",
          targetNodeKey: "A.cs#Foo",
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
    const provider = new CsharpLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    await provider.resolveEdges({ workspaceRoot, files: ["Program.cs"] });

    const didOpen = fake.notifications.find(
      (n) => n.method === LspMethods.DID_OPEN,
    );
    expect((didOpen?.params as any).textDocument.languageId).toBe("csharp");
  });
});
