import type { ILogger } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { checkGoLspPreflight } from "./go-lsp-preflight.js";
import { GoLspConstants } from "./go-lsp-constants.js";
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
  // ancestor-walk mechanism other languages use). This flag stays `false` regardless: flipping it
  // requires verifying gopls's real `documentSymbol` nesting shape for a receiver method against a
  // live server, which this codebase has not done -- not a claim that Tier A can't do this anymore.
  supportsQualifiedContainment: false,
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
