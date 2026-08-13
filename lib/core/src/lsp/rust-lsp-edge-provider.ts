import type { ILogger } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import path from "node:path";
import os from "node:os";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { checkRustLspPreflight } from "./rust-lsp-preflight.js";
import {
  RustLspConstants,
  normalizeRustSymbolName,
} from "./rust-lsp-constants.js";
import { LspSymbolKinds } from "./lsp-constants.js";
import {
  BaseLspEdgeProvider,
  type LspLanguageConfig,
} from "./lsp-edge-provider-base.js";

const DEFAULT_LANGUAGE_ID = "rust";

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  ".rs": DEFAULT_LANGUAGE_ID,
};

function getCargoBinDir(): string {
  return path.join(os.homedir(), ".cargo", "bin");
}

const RUST_LANGUAGE_CONFIG: LspLanguageConfig = {
  name: RustLspConstants.BINARY_NAME,
  languageIdByExtension: LANGUAGE_ID_BY_EXTENSION,
  defaultLanguageId: DEFAULT_LANGUAGE_ID,
  resolveBinary: (workspaceRoot, override) =>
    resolvePathNativeBinary(
      {
        binaryName: RustLspConstants.BINARY_NAME,
        defaultArgs: RustLspConstants.DEFAULT_ARGS as unknown as string[],
        extraCandidateDirs: [getCargoBinDir()],
      },
      override,
    ),
  checkPreflight: checkRustLspPreflight,
  // GRPH-006 (issue #31): Tier A persists Rust methods as `file#Struct.method`
  // (`ast-worker.ts`'s `resolveRustImplContainerName` reads an impl block's own `type` field),
  // so Tier B must emit the same qualified key or `findNodeIdByNodeKey` drops every cross-file
  // rust method edge. Verified live against rust-analyzer 1.97.1: an impl block is a
  // `documentSymbol` parent of kind `Object` (19) named `"impl HaystackBuilder"` -- so the
  // containment ancestor walk must elevate Object-kind ancestors (via `containmentSymbolKinds`,
  // not a global default -- other languages' semantic nesting may not be Tier A's rule), and the
  // `impl ` name prefix must be stripped before it can match the bare struct name
  // (`normalizeSymbolName`). Without all three together, the qualified key never forms.
  supportsQualifiedContainment: true,
  containmentSymbolKinds: new Set([
    LspSymbolKinds.CLASS,
    LspSymbolKinds.OBJECT,
  ]),
  normalizeSymbolName: normalizeRustSymbolName,
  // issue #11 plan A: Rust's own forward-resolution calibration slice hasn't run yet (Slice 4) --
  // stays on the reverse pipeline until it does (FWD-004/D2, single per-language safety gate).
  definitionResolution: "reverse",
};

/**
 * Rust's `IEdgeResolutionProvider` -- all generic batch orchestration/reference-resolution logic
 * lives in `BaseLspEdgeProvider`.
 */
export class RustLspEdgeProvider extends BaseLspEdgeProvider {
  constructor(logger?: ILogger, clientFactory?: () => LspJsonRpcClient) {
    super(RUST_LANGUAGE_CONFIG, logger, clientFactory);
  }
}
