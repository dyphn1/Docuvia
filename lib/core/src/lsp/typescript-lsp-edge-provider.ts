import type { ILogger } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolveLspBinary } from "./lsp-binary-resolver.js";
import { checkLspPreflight } from "./lsp-preflight.js";
import { TsLspConstants } from "./lsp-constants.js";
import {
  BaseLspEdgeProvider,
  type LspLanguageConfig,
} from "./lsp-edge-provider-base.js";

/** LSP `textDocument/didOpen`'s `languageId` values (LSP base spec's registered ids), keyed by
 *  this provider's supported source extensions. */
const DEFAULT_LANGUAGE_ID = "typescript";

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  ".ts": DEFAULT_LANGUAGE_ID,
  ".mts": DEFAULT_LANGUAGE_ID,
  ".cts": DEFAULT_LANGUAGE_ID,
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
};

const TYPESCRIPT_LANGUAGE_CONFIG: LspLanguageConfig = {
  name: TsLspConstants.PACKAGE_NAME,
  languageIdByExtension: LANGUAGE_ID_BY_EXTENSION,
  defaultLanguageId: DEFAULT_LANGUAGE_ID,
  resolveBinary: resolveLspBinary,
  checkPreflight: checkLspPreflight,
};

/**
 * TS/JS's `IEdgeResolutionProvider` (phase1-decision-integration.md §8b; PLAT-007 Tier B) --
 * everything generic (batch orchestration, symbol containment, reference-edge resolution) now
 * lives in `BaseLspEdgeProvider` (multi-language-lsp-support plan, Finding B); this class is just
 * TS/JS's `LspLanguageConfig` plus the thin constructor wiring.
 */
export class TypescriptLspEdgeProvider extends BaseLspEdgeProvider {
  constructor(logger?: ILogger, clientFactory?: () => LspJsonRpcClient) {
    super(TYPESCRIPT_LANGUAGE_CONFIG, logger, clientFactory);
  }
}
