import type { ILogger } from "@workspace/contracts";
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
