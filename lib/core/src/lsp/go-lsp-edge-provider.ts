import type { ILogger } from "@workspace/contracts";
import { TIER_B_LANGUAGE_IDS } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { checkGoLspPreflight } from "./go-lsp-preflight.js";
import { GoLspConstants, normalizeGoSymbolName } from "./go-lsp-constants.js";
import {
  BaseLspEdgeProvider,
  type LspLanguageConfig,
} from "./lsp-edge-provider-base.js";

const DEFAULT_LANGUAGE_ID = "go";

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  ".go": DEFAULT_LANGUAGE_ID,
};

const GO_LANGUAGE_CONFIG: LspLanguageConfig = {
  name: GoLspConstants.BINARY_NAME,
  tierBLanguageId: TIER_B_LANGUAGE_IDS.GO,
  languageIdByExtension: LANGUAGE_ID_BY_EXTENSION,
  defaultLanguageId: DEFAULT_LANGUAGE_ID,
  resolveBinary: (workspaceRoot, override) =>
    resolvePathNativeBinary(
      {
        binaryName: GoLspConstants.BINARY_NAME,
        defaultArgs: GoLspConstants.DEFAULT_ARGS as unknown as string[],
      },
      override,
    ),
  checkPreflight: checkGoLspPreflight,
  // GRPH-006 follow-up: Tier A now resolves Go containment (`ast-worker.ts`'s
  // `resolveGoReceiverContainerName` reads a method_declaration's own `receiver` field directly --
  // `type_declaration` never lexically encloses a `method_declaration`, so this isn't the
  // ancestor-walk mechanism other languages use). The flag stays `false`, but gopls bakes the
  // receiver into the symbol *name* (`(A).Handle`, flat, never nested), so `normalizeSymbolName`
  // recovers Tier A's `A.Handle` key shape from the name alone.
  supportsQualifiedContainment: false,
  // GRPH-006 follow-up: gopls never nests a receiver method under its struct (`documentSymbol`
  // flat entry named `(A).Handle`, struct kind `Struct`(23) not `Class`(5)), so the container
  // can't come from the symbol tree the way TypeScript's does -- recover it from the name.
  normalizeSymbolName: normalizeGoSymbolName,
  // issue #11 plan A: Go's own forward-resolution calibration slice hasn't run yet (Slice 4) --
  // stays on the reverse pipeline until it does (FWD-004/D2, single per-language safety gate).
  definitionResolution: "reverse",
};

/**
 * Go's `IEdgeResolutionProvider` -- all generic batch orchestration/reference-resolution logic
 * lives in `BaseLspEdgeProvider`.
 */
export class GoLspEdgeProvider extends BaseLspEdgeProvider {
  constructor(logger?: ILogger, clientFactory?: () => LspJsonRpcClient) {
    super(GO_LANGUAGE_CONFIG, logger, clientFactory);
  }
}
