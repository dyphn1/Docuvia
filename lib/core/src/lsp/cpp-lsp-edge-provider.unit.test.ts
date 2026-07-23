import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLogger } from "@workspace/contracts";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { CppLspEdgeProvider } from "./cpp-lsp-edge-provider.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-cpplsp-test-"));
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

describe("CppLspEdgeProvider.resolveEdges()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeWorkspace({
      "main.cpp": "int main() {}\n",
    });
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns an empty outcome without touching the client factory when files is empty", async () => {
    const clientFactory = vi.fn();
    const provider = new CppLspEdgeProvider(createMockLogger(), clientFactory);

    const outcome = await provider.resolveEdges({ workspaceRoot, files: [] });

    expect(outcome).toEqual({ edges: [], filesProcessed: [], filesFailed: [] });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("resolves a cross-file symbol-level calls edge via documentSymbol + references (C++)", async () => {
    const customWorkspace = makeWorkspace({
      "Greeter.hpp":
        "namespace myproject {\n    class Greeter {\n    public:\n        void hello();\n    };\n}\n",
      "main.cpp":
        '#include "Greeter.hpp"\nint main() {\n    myproject::Greeter g;\n    g.hello();\n}\n',
    });
    const hppUri = uriFor(customWorkspace, "Greeter.hpp");
    const cppUri = uriFor(customWorkspace, "main.cpp");

    const helloSelectionRange = range(3, 13, 3, 18);
    const mainSelectionRange = range(1, 4, 1, 8);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === hppUri) {
          return [
            {
              name: "myproject",
              kind: LspSymbolKinds.NAMESPACE,
              range: range(0, 0, 5, 1),
              selectionRange: range(0, 10, 0, 19),
              children: [
                {
                  name: "Greeter",
                  kind: LspSymbolKinds.CLASS,
                  range: range(1, 4, 4, 6),
                  selectionRange: range(1, 10, 1, 17),
                  children: [
                    {
                      name: "hello",
                      kind: LspSymbolKinds.METHOD,
                      range: range(3, 8, 3, 21),
                      selectionRange: helloSelectionRange,
                    },
                  ],
                },
              ],
            },
          ];
        }
        if (params.textDocument.uri === cppUri) {
          return [
            {
              name: "main",
              kind: LspSymbolKinds.FUNCTION,
              range: range(1, 0, 4, 1),
              selectionRange: mainSelectionRange,
            },
          ];
        }
        return [];
      }
      if (method === LspMethods.REFERENCES) {
        if (
          params.textDocument.uri === hppUri &&
          params.position.line === helloSelectionRange.start.line &&
          params.position.character === helloSelectionRange.start.character
        ) {
          return [{ uri: cppUri, range: range(3, 6, 3, 11) }];
        }
        return [];
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const fake = new FakeLspClient(handler);
    const provider = new CppLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    try {
      const outcome = await provider.resolveEdges({
        workspaceRoot: customWorkspace,
        files: ["Greeter.hpp", "main.cpp"],
      });

      expect(outcome.filesFailed).toEqual([]);
      expect(outcome.filesProcessed).toEqual(["Greeter.hpp", "main.cpp"]);
      expect(outcome.edges).toEqual([
        {
          sourceNodeKey: "main.cpp#main",
          targetNodeKey: "Greeter.hpp#hello",
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
    const provider = new CppLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    await provider.resolveEdges({ workspaceRoot, files: ["main.cpp"] });

    const didOpen = fake.notifications.find(
      (n) => n.method === LspMethods.DID_OPEN,
    );
    expect((didOpen?.params as any).textDocument.languageId).toBe("cpp");
  });
});
