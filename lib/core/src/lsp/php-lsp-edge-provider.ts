import type { ILogger } from "@workspace/contracts";
import { TIER_B_LANGUAGE_IDS } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolveNpmNpxBinary } from "./lsp-binary-resolver-strategies.js";
import { checkPhpLspPreflight } from "./php-lsp-preflight.js";
import { PhpLspConstants, PHP_LSP_MESSAGES } from "./php-lsp-constants.js";
import {
  BaseLspEdgeProvider,
  type LspLanguageConfig,
} from "./lsp-edge-provider-base.js";

const DEFAULT_LANGUAGE_ID = "php";

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  ".php": DEFAULT_LANGUAGE_ID,
  ".phtml": DEFAULT_LANGUAGE_ID,
  ".php3": DEFAULT_LANGUAGE_ID,
  ".php4": DEFAULT_LANGUAGE_ID,
  ".php5": DEFAULT_LANGUAGE_ID,
  ".phps": DEFAULT_LANGUAGE_ID,
};

const PHP_LANGUAGE_CONFIG: LspLanguageConfig = {
  name: PhpLspConstants.PACKAGE_NAME,
  tierBLanguageId: TIER_B_LANGUAGE_IDS.PHP,
  languageIdByExtension: LANGUAGE_ID_BY_EXTENSION,
  defaultLanguageId: DEFAULT_LANGUAGE_ID,
  resolveBinary: (workspaceRoot, override) =>
    resolveNpmNpxBinary(
      workspaceRoot,
      {
        packageName: PhpLspConstants.PACKAGE_NAME,
        defaultArgs: [PhpLspConstants.STDIO_ARG],
      },
      override,
    ),
  checkPreflight: checkPhpLspPreflight,
  supportsQualifiedContainment: true,
  // issue #11 plan A: PHP's own forward-resolution calibration slice hasn't run yet (Slice 4) --
  // stays on the reverse pipeline until it does (FWD-004/D2, single per-language safety gate).
  definitionResolution: "reverse",
  // issue #32: npm/npx-fallback language -- when the spawned npx process exits before finishing
  // initialize (package not cached), surface this friendly preflight reason instead of npm stderr.
  unavailableReasonForUnresolvableBinary: PHP_LSP_MESSAGES.binaryUnresolvable,
};

/**
 * PHP's `IEdgeResolutionProvider` -- all generic batch orchestration/reference-resolution logic
 * lives in `BaseLspEdgeProvider`.
 */
export class PhpLspEdgeProvider extends BaseLspEdgeProvider {
  constructor(logger?: ILogger, clientFactory?: () => LspJsonRpcClient) {
    super(PHP_LANGUAGE_CONFIG, logger, clientFactory);
  }
}
