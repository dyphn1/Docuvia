import type { ILogger } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { checkCsharpLspPreflight } from "./csharp-lsp-preflight.js";
import { CsharpLspConstants } from "./csharp-lsp-constants.js";
import {
  BaseLspEdgeProvider,
  type LspLanguageConfig,
} from "./lsp-edge-provider-base.js";

const DEFAULT_LANGUAGE_ID = "csharp";

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  ".cs": DEFAULT_LANGUAGE_ID,
};

const CSHARP_LANGUAGE_CONFIG: LspLanguageConfig = {
  name: CsharpLspConstants.BINARY_NAME,
  languageIdByExtension: LANGUAGE_ID_BY_EXTENSION,
  defaultLanguageId: DEFAULT_LANGUAGE_ID,
  resolveBinary: (workspaceRoot, override) =>
    resolvePathNativeBinary(
      {
        binaryName: CsharpLspConstants.BINARY_NAME,
        defaultArgs: CsharpLspConstants.DEFAULT_ARGS as unknown as string[],
      },
      override,
    ),
  checkPreflight: checkCsharpLspPreflight,
  supportsQualifiedContainment: true,
  // issue #11 plan A: C#'s own forward-resolution calibration slice hasn't run yet (Slice 4) --
  // stays on the reverse pipeline until it does (FWD-004/D2, single per-language safety gate).
  // C# is explicitly flagged in the plan doc as possibly staying reverse permanently even after
  // calibration (see docuvia2's own native-resolver architecture decision for csharp).
  definitionResolution: "reverse",
};

/**
 * C#'s `IEdgeResolutionProvider` -- all generic batch orchestration/reference-resolution logic
 * lives in `BaseLspEdgeProvider`.
 */
export class CsharpLspEdgeProvider extends BaseLspEdgeProvider {
  constructor(logger?: ILogger, clientFactory?: () => LspJsonRpcClient) {
    super(CSHARP_LANGUAGE_CONFIG, logger, clientFactory);
  }
}
