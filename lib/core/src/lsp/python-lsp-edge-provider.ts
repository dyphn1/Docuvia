import type { ILogger } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolveNpmNpxBinary } from "./lsp-binary-resolver-strategies.js";
import { checkPythonLspPreflight } from "./python-lsp-preflight.js";
import { PyLspConstants, PY_LSP_MESSAGES } from "./python-lsp-constants.js";
import {
  BaseLspEdgeProvider,
  type LspLanguageConfig,
} from "./lsp-edge-provider-base.js";

/** LSP `textDocument/didOpen`'s `languageId` values (LSP base spec's registered ids), keyed by
 *  this provider's supported source extension -- mirrors `typescript-lsp-edge-provider.ts`'s
 *  shape, just for Python's single extension. */
const DEFAULT_LANGUAGE_ID = "python";

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  ".py": DEFAULT_LANGUAGE_ID,
};

const PYTHON_LANGUAGE_CONFIG: LspLanguageConfig = {
  name: PyLspConstants.PACKAGE_NAME,
  languageIdByExtension: LANGUAGE_ID_BY_EXTENSION,
  defaultLanguageId: DEFAULT_LANGUAGE_ID,
  resolveBinary: (workspaceRoot, override) =>
    resolveNpmNpxBinary(
      workspaceRoot,
      {
        packageName: PyLspConstants.PACKAGE_NAME,
        binaryName: PyLspConstants.BINARY_NAME,
        defaultArgs: [PyLspConstants.STDIO_ARG],
      },
      override,
    ),
  checkPreflight: checkPythonLspPreflight,
  supportsQualifiedContainment: true,
  // issue #11 plan A: Python's own forward-resolution calibration slice hasn't run yet (Slice 4) --
  // stays on the reverse pipeline until it does (FWD-004/D2, single per-language safety gate).
  definitionResolution: "reverse",
  // issue #32: npm/npx-fallback language -- when the spawned npx process exits before finishing
  // initialize (package not cached), surface this friendly preflight reason instead of npm stderr.
  unavailableReasonForUnresolvableBinary: PY_LSP_MESSAGES.binaryUnresolvable,
};

/**
 * Python's `IEdgeResolutionProvider` (multi-language-lsp-support plan, Slice 1) -- all generic
 * batch orchestration/reference-resolution logic lives in `BaseLspEdgeProvider`; this class is
 * just Python's `LspLanguageConfig` plus the thin constructor wiring, mirroring exactly how
 * `TypescriptLspEdgeProvider` wires onto the same base (Slice 0, Finding B).
 */
export class PythonLspEdgeProvider extends BaseLspEdgeProvider {
  constructor(logger?: ILogger, clientFactory?: () => LspJsonRpcClient) {
    super(PYTHON_LANGUAGE_CONFIG, logger, clientFactory);
  }
}
