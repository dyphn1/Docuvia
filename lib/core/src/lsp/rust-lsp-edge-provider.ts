import type { ILogger } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import path from "node:path";
import os from "node:os";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { checkRustLspPreflight } from "./rust-lsp-preflight.js";
import { RustLspConstants } from "./rust-lsp-constants.js";
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
  // GRPH-006 follow-up: Tier A now resolves Rust containment (`ast-worker.ts`'s
  // `resolveRustImplContainerName` reads an impl block's own `type` field directly -- `impl_item`
  // is still deliberately excluded from `rustConfig.classes`, so this isn't the ancestor-walk
  // mechanism other languages use). This flag stays `false` regardless: flipping it requires
  // verifying rust-analyzer's real `documentSymbol` nesting shape (does it nest a method under a
  // parent symbol whose kind/name actually match "the impl's target struct"?) against a live
  // server, which this codebase has not done -- not a claim that Tier A can't do this anymore.
  supportsQualifiedContainment: false,
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
