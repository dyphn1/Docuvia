import type { ILogger } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolveTypeScriptLspBinary } from "./typescript-lsp-binary-resolver.js";
import { checkTypeScriptLspPreflight } from "./typescript-lsp-preflight.js";
import {
  TsLspConstants,
  TS_LSP_MESSAGES,
  DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB,
} from "./typescript-lsp-constants.js";
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
  resolveBinary: resolveTypeScriptLspBinary,
  checkPreflight: checkTypeScriptLspPreflight,
  supportsQualifiedContainment: true,
  // roadmap item 28: typescript-language-server reads this key directly off the initialize
  // request and forwards it as tsserver's own --max-old-space-size arg -- the mechanism that
  // actually reaches tsserver's heap ceiling (see DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB's doc comment).
  initializationOptions: {
    maxTsServerMemory: DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB,
  },
  // issue #11 plan A, Slice 3: TS/JS is the first language calibrated for forward resolution --
  // Tier A's ast_call_sites positions are seeded correctly (Finding C fix) and Phase 3's
  // real-typescript-language-server parity test proves `textDocument/definition` resolves both
  // plain and member calls against this provider.
  definitionResolution: "forward",
  // issue #32: npm/npx-fallback language -- when `npx --no-install typescript-language-server`
  // spawns then exits before finishing initialize (package not cached), surface this friendly
  // preflight reason instead of npm's raw stderr on the degraded language.
  unavailableReasonForUnresolvableBinary: TS_LSP_MESSAGES.binaryUnresolvable,
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
