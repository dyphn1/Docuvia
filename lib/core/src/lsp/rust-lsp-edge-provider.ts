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
