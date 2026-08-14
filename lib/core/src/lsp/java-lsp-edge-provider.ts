import type { ILogger } from "@workspace/contracts";
import { TIER_B_LANGUAGE_IDS } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { checkJavaLspPreflight } from "./java-lsp-preflight.js";
import { JavaLspConstants } from "./java-lsp-constants.js";
import {
  BaseLspEdgeProvider,
  type LspLanguageConfig,
} from "./lsp-edge-provider-base.js";

const DEFAULT_LANGUAGE_ID = "java";

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  ".java": DEFAULT_LANGUAGE_ID,
};

const JAVA_LANGUAGE_CONFIG: LspLanguageConfig = {
  name: JavaLspConstants.BINARY_NAME,
  tierBLanguageId: TIER_B_LANGUAGE_IDS.JAVA,
  languageIdByExtension: LANGUAGE_ID_BY_EXTENSION,
  defaultLanguageId: DEFAULT_LANGUAGE_ID,
  resolveBinary: (workspaceRoot, override) =>
    resolvePathNativeBinary(
      {
        binaryName: JavaLspConstants.BINARY_NAME,
        defaultArgs: JavaLspConstants.DEFAULT_ARGS as unknown as string[],
      },
      override,
    ),
  checkPreflight: checkJavaLspPreflight,
  supportsQualifiedContainment: true,
  // issue #11 plan A: Java's own forward-resolution calibration slice hasn't run yet (Slice 4) --
  // stays on the reverse pipeline until it does (FWD-004/D2, single per-language safety gate).
  definitionResolution: "reverse",
};

/**
 * Java's `IEdgeResolutionProvider` -- all generic batch orchestration/reference-resolution logic
 * lives in `BaseLspEdgeProvider`.
 */
export class JavaLspEdgeProvider extends BaseLspEdgeProvider {
  constructor(logger?: ILogger, clientFactory?: () => LspJsonRpcClient) {
    super(JAVA_LANGUAGE_CONFIG, logger, clientFactory);
  }
}
