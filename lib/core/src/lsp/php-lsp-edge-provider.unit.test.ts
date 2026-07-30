import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockLogger } from "@workspace/contracts";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { PhpLspEdgeProvider } from "./php-lsp-edge-provider.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-phplsp-test-"));
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

describe("PhpLspEdgeProvider.resolveEdges()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeWorkspace({
      "index.php": "<?php echo 'hello'; ?>\n",
    });
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns an empty outcome without touching the client factory when files is empty", async () => {
    const clientFactory = vi.fn();
    const provider = new PhpLspEdgeProvider(createMockLogger(), clientFactory);

    const outcome = await provider.resolveEdges({ workspaceRoot, files: [] });

    expect(outcome).toEqual({ edges: [], filesProcessed: [], filesFailed: [] });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("resolves a cross-file symbol-level calls edge via documentSymbol + references (PHP)", async () => {
    const customWorkspace = makeWorkspace({
      "a.php":
        "<?php\nnamespace MyProject;\nclass A {\n    public function foo() {}\n}\n",
      "b.php":
        "<?php\nnamespace MyProject;\nclass B {\n    public function bar() {\n        $a = new A();\n        $a->foo();\n    }\n}\n",
    });
    const aUri = uriFor(customWorkspace, "a.php");
    const bUri = uriFor(customWorkspace, "b.php");

    const fooSelectionRange = range(3, 20, 3, 23);
    const barSelectionRange = range(3, 20, 3, 23);

    const handler: RequestHandler = (method, params) => {
      if (method === LspMethods.INITIALIZE) return {};
      if (method === LspMethods.DOCUMENT_SYMBOL) {
        if (params.textDocument.uri === aUri) {
          return [
            {
              name: "MyProject",
              kind: LspSymbolKinds.NAMESPACE,
              range: range(1, 0, 5, 1),
              selectionRange: range(1, 10, 1, 19),
              children: [
                {
                  name: "A",
                  kind: LspSymbolKinds.CLASS,
                  range: range(2, 0, 4, 1),
                  selectionRange: range(2, 6, 2, 7),
                  children: [
                    {
                      name: "foo",
                      kind: LspSymbolKinds.METHOD,
                      range: range(3, 4, 3, 28),
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
              range: range(1, 0, 9, 1),
              selectionRange: range(1, 10, 1, 19),
              children: [
                {
                  name: "B",
                  kind: LspSymbolKinds.CLASS,
                  range: range(2, 0, 8, 1),
                  selectionRange: range(2, 6, 2, 7),
                  children: [
                    {
                      name: "bar",
                      kind: LspSymbolKinds.METHOD,
                      range: range(3, 4, 7, 5),
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
          return [{ uri: bUri, range: range(5, 12, 5, 15) }];
        }
        return [];
      }
      if (method === LspMethods.SHUTDOWN) return null;
      return undefined;
    };

    const fake = new FakeLspClient(handler);
    const provider = new PhpLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    try {
      const outcome = await provider.resolveEdges({
        workspaceRoot: customWorkspace,
        files: ["a.php", "b.php"],
      });

      expect(outcome.filesFailed).toEqual([]);
      expect(outcome.filesProcessed).toEqual(["a.php", "b.php"]);
      expect(outcome.edges).toEqual([
        {
          // Qualified with the enclosing class (GRPH-006): PHP's supportsQualifiedContainment:
          // true, and the namespace-kind ancestor doesn't count as a container (only the nearest
          // CLASS-kind one does), so this is "B.bar", not "MyProject.bar".
          sourceNodeKey: "b.php#B.bar",
          targetNodeKey: "a.php#A.foo",
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
    const provider = new PhpLspEdgeProvider(createMockLogger(), () =>
      asClient(fake),
    );

    await provider.resolveEdges({ workspaceRoot, files: ["index.php"] });

    const didOpen = fake.notifications.find(
      (n) => n.method === LspMethods.DID_OPEN,
    );
    expect((didOpen?.params as any).textDocument.languageId).toBe("php");
  });
});
