import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedCallEdge } from "@workspace/contracts";
import { RustLspEdgeProvider } from "./rust-lsp-edge-provider.js";
import {
  LspJsonRpcClient,
  type LspJsonRpcClientOptions,
} from "./lsp-json-rpc-client.js";
import { LspMethods, LspSymbolKinds } from "./lsp-constants.js";
import { rmSyncRetrying } from "./windows-rm-retry.test-support.js";

/**
 * Live rust-analyzer integration test (issue #31). Mirrors
 * `typescript-lsp-edge-provider.forward-parity.integration.test.ts`'s structure: spawns the
 * *real* `rust-analyzer` binary against a tiny cargo fixture and asserts the two things the fix
 * depends on:
 *
 *  1. `textDocument/documentSymbol` really nests impl-block methods under a parent of kind
 *     `Object` (19) named `impl <Type>` (the shape the `containmentSymbolKinds` /
 *     `normalizeSymbolName` additions were verified against), and
 *  2. a real `textDocument/references` round-trip through `RustLspEdgeProvider.resolveEdges`
 *     emits the Tier-A-aligned qualified key `src/lib.rs#Greeter.hello` (previously the flat
 *     `src/lib.rs#hello` key, which `findNodeIdByNodeKey` never matched -- the 0-corrected-edges
 *     bug on both ripgrep and tauri).
 *
 * Guarded by `provider.checkAvailability()` -- self-skips (does not fail) if rust-analyzer can't
 * be resolved/spawned in this environment.
 *
 * `SettlingLspClient` wraps the real `LspJsonRpcClient` behind the provider's documented test
 * seam and adds the same cold-start settle the TS parity test needs: rust-analyzer's first
 * semantic request (`textDocument/references`) issued before its async project/crate-graph load
 * finishes can come back empty even though the same request succeeds moments later.
 */
class SettlingLspClient {
  private readonly real = new LspJsonRpcClient();
  private settle: Promise<void> | undefined;

  start(options: LspJsonRpcClientOptions): Promise<void> {
    return this.real.start(options);
  }

  notify(method: string, params: unknown): void {
    this.real.notify(method, params);
  }

  async request<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<T> {
    if (method === LspMethods.REFERENCES || method === LspMethods.DEFINITION) {
      this.settle ??= new Promise((resolve) => setTimeout(resolve, 8000));
      await this.settle;
    }
    return this.real.request<T>(method, params, timeoutMs);
  }

  stop(): Promise<void> {
    return this.real.stop();
  }
}

const LIB_SRC = `pub struct Greeter;

impl Greeter {
    pub fn new() -> Greeter {
        Greeter
    }
    pub fn hello(&self) {}
}
`;
const MAIN_SRC = `use docuvia_rust_fixture::Greeter;

fn main() {
    let g = Greeter::new();
    g.hello();
}
`;
const CARGO_TOML = `[package]
name = "docuvia-rust-fixture"
version = "0.1.0"
edition = "2021"

[lib]
path = "src/lib.rs"

[[bin]]
name = "docuvia-rust-fixture-bin"
path = "src/main.rs"
`;

function pairKeys(edges: ResolvedCallEdge[]): Set<string> {
  return new Set(edges.map((e) => `${e.sourceNodeKey}->${e.targetNodeKey}`));
}

describe("RustLspEdgeProvider live rust-analyzer (issue #31: Object-kind impl containment + qualified node_key)", () => {
  let workspaceRoot: string;
  let provider: RustLspEdgeProvider;
  let available = false;
  let skipReason = "";

  beforeAll(async () => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-rust-live-"),
    );
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "Cargo.toml"), CARGO_TOML);
    fs.writeFileSync(path.join(workspaceRoot, "src", "lib.rs"), LIB_SRC);
    fs.writeFileSync(path.join(workspaceRoot, "src", "main.rs"), MAIN_SRC);

    provider = new RustLspEdgeProvider(
      undefined,
      () => new SettlingLspClient() as unknown as LspJsonRpcClient,
    );
    const availability = await provider.checkAvailability(workspaceRoot);
    available = availability.available;
    if (!available) {
      skipReason =
        availability.reason ??
        "rust-analyzer unavailable for an unspecified reason";
      console.log(
        `[rust-lsp-edge-provider.live.integration.test] skipping real-server assertion: ${skipReason}`,
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (workspaceRoot) await rmSyncRetrying(workspaceRoot);
  });

  it("real rust-analyzer documentSymbol nests an impl block's associated fn AND &self method under a kind-Object(19) parent named 'impl <Type>' -- the shape supportsQualifiedContainment now assumes", async () => {
    if (!available) {
      console.log(
        `[rust-lsp-edge-provider.live.integration.test] skipped (${skipReason})`,
      );
      return;
    }

    const client = new LspJsonRpcClient();
    const libUri = pathToFileURL(
      path.join(workspaceRoot, "src", "lib.rs"),
    ).toString();
    try {
      await client.start({
        command: "rust-analyzer",
        args: [],
        cwd: workspaceRoot,
      });
      await client.request(
        LspMethods.INITIALIZE,
        {
          processId: process.pid,
          rootUri: pathToFileURL(workspaceRoot).toString(),
          capabilities: {
            textDocument: {
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            },
          },
        },
        30_000,
      );
      client.notify(LspMethods.INITIALIZED, {});
      client.notify(LspMethods.DID_OPEN, {
        textDocument: {
          uri: libUri,
          languageId: "rust",
          version: 1,
          text: LIB_SRC,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const symbols = await client.request<
        {
          name: string;
          kind: number;
          children?: { name: string; kind: number }[];
        }[]
      >(LspMethods.DOCUMENT_SYMBOL, { textDocument: { uri: libUri } }, 30_000);

      const implParent = symbols.find(
        (s) =>
          s.kind === LspSymbolKinds.OBJECT &&
          s.name.startsWith("impl ") &&
          s.name.includes("Greeter"),
      );
      expect(implParent).toBeDefined();
      expect(implParent!.name).toBe("impl Greeter");
      const children = implParent!.children ?? [];
      expect(children.find((c) => c.name === "new")?.kind).toBe(
        LspSymbolKinds.FUNCTION,
      );
      expect(children.find((c) => c.name === "hello")?.kind).toBe(
        LspSymbolKinds.METHOD,
      );
    } finally {
      try {
        await client.request(LspMethods.SHUTDOWN, null, 5_000);
        client.notify(LspMethods.EXIT, {});
      } catch {
        // best-effort teardown
      }
      await client.stop();
    }
  }, 60_000);

  it("a real references round-trip resolves a cross-file impl-block method call onto Tier A's qualified 'src/lib.rs#Greeter.hello' node_key (not the flat key that silently dropped every rust edge)", async () => {
    if (!available) {
      console.log(
        `[rust-lsp-edge-provider.live.integration.test] skipped (${skipReason})`,
      );
      return;
    }

    const outcome = await provider.resolveEdges({
      workspaceRoot,
      files: ["src/lib.rs", "src/main.rs"],
    });

    expect(outcome.filesFailed).toEqual([]);

    const pairs = pairKeys(outcome.edges);
    const qualifiedEdge = [...pairs].find(
      (pair) =>
        pair.includes("src/lib.rs") &&
        pair.includes("Greeter") &&
        pair.includes("hello") &&
        pair.includes("src/main.rs") &&
        pair.includes("main"),
    );
    expect(qualifiedEdge).toBeDefined();
    expect(qualifiedEdge).toContain("src/lib.rs#Greeter.hello");
  }, 60_000);
});
