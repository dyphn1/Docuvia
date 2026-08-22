import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  EdgeResolutionCallSite,
  ResolvedCallEdge,
} from "@workspace/contracts";
import { TypescriptLspEdgeProvider } from "./typescript-lsp-edge-provider.js";
import { buildParseResponse } from "../ast/ast-worker.js";
import {
  LspJsonRpcClient,
  type LspJsonRpcClientOptions,
} from "./lsp-json-rpc-client.js";
import { LspMethods } from "./lsp-constants.js";
import { rmSyncRetrying } from "./windows-rm-retry.test-support.js";

/**
 * Real-server parity test (issue #11 plan A, Slice 3, Phase 3 -- the plan doc's own explicit
 * Slice 3 test requirement). Spawns the *real* `typescript-language-server` binary (already a
 * workspace-root devDependency, `package.json`: `"typescript-language-server": "^5.3.0"`,
 * `"typescript": "catalog:"`) against a small real fixture covering both call shapes Finding C's
 * fix distinguishes: a plain call (`doWork()`) and a member call (`logger.info(...)`). Proves
 * forward resolution (Phase 0's persisted `ast_call_sites` positions, seeded via
 * `textDocument/definition`) produces the identical edge set reverse resolution
 * (`documentSymbol` + `textDocument/references`) already produced -- a mismatch on the member-call
 * edge specifically is the canary for Finding C regressing.
 *
 * Guarded by `provider.checkAvailability()` -- self-skips (does not fail) if the binary can't be
 * resolved/spawned in this environment, per the plan's own "should self-skip gracefully" note.
 *
 * `SettlingLspClient` (below) wraps the real `LspJsonRpcClient` behind `TypescriptLspEdgeProvider`'s
 * own documented test seam (its constructor's `clientFactory` param -- "tests inject a fake client
 * to exercise this class's cross-file edge-resolution logic without spawning a real process"; here
 * it wraps a *real* one instead of faking it). Diagnosed live against this exact fixture: a freshly
 * spawned `typescript-language-server` needs several real elapsed seconds after its first
 * `textDocument/didOpen` before tsserver's own async project load (parsing tsconfig + all included
 * files) completes -- `textDocument/documentSymbol` (purely syntactic, single-file) answers
 * correctly immediately, but the first `textDocument/references`/`textDocument/definition` request
 * issued too early comes back empty even though the exact same request succeeds once that load
 * finishes (confirmed by manually delaying and retrying against a raw session). This is a real
 * characteristic of `typescript-language-server`'s own cold-start behavior, not a bug in
 * `BaseLspEdgeProvider`'s request logic -- see this file's own "flag, don't fix" note below.
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
      // One shared settle wait per session (not per request) -- every semantic request after the
      // first waits on the same already-resolved promise, so this only costs real wall-clock time
      // once per spawned `typescript-language-server` process.
      // Windows CI runners are ~2× slower at LSP server cold-start, so extend the settle
      // proportionally to avoid premature client shutdown (observed on windows-latest in #175).
      const settleMs = process.platform === "win32" ? 6_000 : 3_000;
      this.settle ??= new Promise((resolve) => setTimeout(resolve, settleMs));
      await this.settle;
    }
    return this.real.request<T>(method, params, timeoutMs);
  }

  stop(): Promise<void> {
    return this.real.stop();
  }
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const TS_LANGUAGE_SERVER_BIN = path.join(
  REPO_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32"
    ? "typescript-language-server.cmd"
    : "typescript-language-server",
);
const REPO_TYPESCRIPT_PKG = path.join(REPO_ROOT, "node_modules", "typescript");

const LOGGER_SRC = `export class Logger {
  info(msg: string) {}
}
export const logger = new Logger();
`;
const SERVICE_SRC = `import { logger } from "./logger";

export function doWork() {
  logger.info("hi");
}
`;
const INDEX_SRC = `import { doWork } from "./service";

export function main() {
  doWork();
}
`;
const TSCONFIG_SRC = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2020",
      module: "commonjs",
      moduleResolution: "node",
      strict: false,
    },
    include: ["src/**/*.ts"],
  },
  null,
  2,
);

function pairKeys(edges: ResolvedCallEdge[]): Set<string> {
  return new Set(edges.map((e) => `${e.sourceNodeKey}->${e.targetNodeKey}`));
}

describe("TypescriptLspEdgeProvider forward-vs-reverse parity (real typescript-language-server, issue #11 plan A Slice 3 Phase 3)", () => {
  let workspaceRoot: string;
  let provider: TypescriptLspEdgeProvider;
  let available = false;
  let skipReason = "";

  beforeAll(async () => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-ts-forward-parity-"),
    );
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "tsconfig.json"), TSCONFIG_SRC);
    fs.writeFileSync(path.join(workspaceRoot, "src", "logger.ts"), LOGGER_SRC);
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "service.ts"),
      SERVICE_SRC,
    );
    fs.writeFileSync(path.join(workspaceRoot, "src", "index.ts"), INDEX_SRC);

    // typescript-language-server has no runtime `dependencies` on `typescript` itself (checked
    // its own package.json -- only a devDependency of the server's own build), so it resolves
    // tsserver by walking up node_modules from the *project* it's told to serve. A fixture with
    // no locally-resolvable `typescript` package would make every definition/references request
    // fail to produce results, silently defeating this test rather than skipping it honestly. A
    // recursive copy (not a symlink/junction) of the repo root's already-installed copy sidesteps
    // any Windows symlink-privilege/cross-drive-junction uncertainty -- a one-time ~20MB copy in
    // `beforeAll`, not a per-test cost.
    fs.mkdirSync(path.join(workspaceRoot, "node_modules"), {
      recursive: true,
    });
    if (fs.existsSync(REPO_TYPESCRIPT_PKG)) {
      fs.cpSync(
        REPO_TYPESCRIPT_PKG,
        path.join(workspaceRoot, "node_modules", "typescript"),
        { recursive: true, dereference: true },
      );
    }

    provider = new TypescriptLspEdgeProvider(
      undefined,
      () => new SettlingLspClient() as unknown as LspJsonRpcClient,
    );
    if (fs.existsSync(TS_LANGUAGE_SERVER_BIN)) {
      provider.configure({ binaryOverride: TS_LANGUAGE_SERVER_BIN });
    }

    const availability = await provider.checkAvailability(workspaceRoot);
    available = availability.available;
    if (!available) {
      skipReason =
        availability.reason ??
        "typescript-language-server unavailable for an unspecified reason";
      console.log(
        `[forward-parity.integration.test] skipping real-server assertion: ${skipReason}`,
      );
    }
  }, 60_000);

  afterAll(async () => {
    // A just-exited typescript-language-server child process can briefly keep a Windows handle
    // open on the copied `node_modules/typescript` tree after `resolveEdges()` has already
    // resolved -- retry past that teardown race instead of failing the suite over it (same
    // shape `python-lsp-edge-provider.unit.test.ts` already retries for the npx-probe case).
    if (workspaceRoot) await rmSyncRetrying(workspaceRoot);
  });

  it("forward (AST-seeded textDocument/definition) resolves both the plain-call and member-call edges, and every forward edge is also justifiable by reverse (documentSymbol + textDocument/references) -- IMPT-002, never inventing an edge", async () => {
    if (!available) {
      // Self-skip, per the plan's own "should self-skip gracefully" note -- do not fake a pass,
      // but do not hard-fail an environment without the binary either.
      console.log(`[forward-parity.integration.test] skipped (${skipReason})`);
      return;
    }

    // Step 1: real Tier A extraction over the fixture (buildParseResponse, matching
    // persist-ast-graph.unit.test.ts's own real-parse pattern) -- proves Phase 0's Finding C fix
    // end to end, against the real tree-sitter query, not a hand-built call site.
    const serviceParse = await buildParseResponse({
      taskId: "forward-parity-service",
      filePath: "src/service.ts",
      code: SERVICE_SRC,
      language: "typescript",
    });
    const indexParse = await buildParseResponse({
      taskId: "forward-parity-index",
      filePath: "src/index.ts",
      code: INDEX_SRC,
      language: "typescript",
    });

    expect(serviceParse.data!.calls.length).toBeGreaterThan(0);
    expect(indexParse.data!.calls.length).toBeGreaterThan(0);

    const toCallSites = (
      calls: NonNullable<typeof serviceParse.data>["calls"],
    ): EdgeResolutionCallSite[] =>
      calls.map((c) => ({
        targetFunction: c.targetFunction,
        startLine: c.startLine,
        startColumn: c.startColumn,
      }));

    const callsByFile: Record<string, EdgeResolutionCallSite[]> = {
      "src/service.ts": toCallSites(serviceParse.data!.calls),
      "src/index.ts": toCallSites(indexParse.data!.calls),
    };

    const files = ["src/logger.ts", "src/service.ts", "src/index.ts"];

    // Step 2: forward path (needs Phase 1's config -- TypescriptLspEdgeProvider's
    // definitionResolution: "forward" -- already merged for this to exercise anything but reverse).
    const forwardOutcome = await provider.resolveEdges({
      workspaceRoot,
      files,
      callsByFile,
    });
    // Step 3: reverse path (no callsByFile).
    const reverseOutcome = await provider.resolveEdges({
      workspaceRoot,
      files,
    });

    expect(forwardOutcome.filesFailed).toEqual([]);
    expect(reverseOutcome.filesFailed).toEqual([]);

    const forwardPairs = pairKeys(forwardOutcome.edges);
    const reversePairs = pairKeys(reverseOutcome.edges);

    // Step 4: every forward edge must also be justifiable by reverse (IMPT-002: forward must
    // never invent an edge reverse itself wouldn't also find) -- asserted against real server
    // output, not assumed set-equality. Empirically, reverse's own edge set can be a *strict
    // superset* of forward's for a structural reason unrelated to Finding C: `textDocument/
    // references` for `doWork` also matches `doWork`'s own name inside the `import { doWork }
    // from "./service"` specifier in index.ts (a real reference, per the LSP spec) -- that
    // reference sits outside any function symbol, so `resolveReferenceEdge` falls back to a
    // file-level edge (`src/index.ts -> src/service.ts#doWork`) with no calling function
    // attributed. Forward seeds itself purely from Tier A's `ast_call_sites` (real
    // `call_expression` nodes only, per `collectCallEdges`) and structurally has no AST node for
    // an import specifier to seed from, so it can never produce that particular edge -- this is a
    // pre-existing reverse-pipeline behavior, not a Slice 3 regression, and not something forward
    // needs to (or safely could) replicate.
    for (const pair of forwardPairs) {
      expect(reversePairs.has(pair)).toBe(true);
    }

    // The plain-call edge (index.ts#main -> service.ts#doWork) must be present -- asserted against
    // real output (substring match on both endpoints), not a hand-guessed exact node_key string.
    const plainCallEdge = [...forwardPairs].find(
      (pair) =>
        pair.includes("index.ts") &&
        pair.includes("main") &&
        pair.includes("service.ts") &&
        pair.includes("doWork"),
    );
    expect(plainCallEdge).toBeDefined();

    // The member-call edge (service.ts#doWork -> logger.ts#Logger.info or equivalent) -- the
    // canary for Finding C (issue #11 plan A) regressing: if the seeded position lands back on the
    // receiver (`logger`) instead of the callee (`info`), `definition` would resolve `logger`'s own
    // declaration/import instead, producing no edge into logger.ts's `info` method at all here.
    const memberCallEdge = [...forwardPairs].find(
      (pair) =>
        pair.includes("service.ts") &&
        pair.includes("doWork") &&
        pair.includes("logger.ts") &&
        pair.toLowerCase().includes("info"),
    );
    expect(memberCallEdge).toBeDefined();
  }, 60_000);
});
