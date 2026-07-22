import type { ILogger } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { checkCppLspPreflight } from "./cpp-lsp-preflight.js";
import { CppLspConstants } from "./cpp-lsp-constants.js";
import {
  BaseLspEdgeProvider,
  type LspLanguageConfig,
} from "./lsp-edge-provider-base.js";

const DEFAULT_LANGUAGE_ID = "cpp";

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  ".c": "c",
  ".h": "c",
  ".cpp": DEFAULT_LANGUAGE_ID,
  ".cxx": DEFAULT_LANGUAGE_ID,
  ".cc": DEFAULT_LANGUAGE_ID,
  ".hpp": DEFAULT_LANGUAGE_ID,
  ".hxx": DEFAULT_LANGUAGE_ID,
  ".hh": DEFAULT_LANGUAGE_ID,
  ".cu": DEFAULT_LANGUAGE_ID,
  ".cuh": DEFAULT_LANGUAGE_ID,
};

const CPP_LANGUAGE_CONFIG: LspLanguageConfig = {
  name: CppLspConstants.BINARY_NAME,
  languageIdByExtension: LANGUAGE_ID_BY_EXTENSION,
  defaultLanguageId: DEFAULT_LANGUAGE_ID,
  resolveBinary: (workspaceRoot, override) =>
    resolvePathNativeBinary(
      {
        binaryName: CppLspConstants.BINARY_NAME,
        defaultArgs: CppLspConstants.DEFAULT_ARGS as unknown as string[],
      },
      override,
    ),
  checkPreflight: checkCppLspPreflight,
};

/**
 * C/C++'s `IEdgeResolutionProvider` -- all generic batch orchestration/reference-resolution logic
 * lives in `BaseLspEdgeProvider`.
 */
export class CppLspEdgeProvider extends BaseLspEdgeProvider {
  constructor(logger?: ILogger, clientFactory?: () => LspJsonRpcClient) {
    super(CPP_LANGUAGE_CONFIG, logger, clientFactory);
  }
}
