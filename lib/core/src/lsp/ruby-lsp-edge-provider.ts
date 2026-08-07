import type { ILogger } from "@workspace/contracts";
import type { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { checkRubyLspPreflight } from "./ruby-lsp-preflight.js";
import { RubyLspConstants } from "./ruby-lsp-constants.js";
import {
  BaseLspEdgeProvider,
  type LspLanguageConfig,
} from "./lsp-edge-provider-base.js";

const DEFAULT_LANGUAGE_ID = "ruby";

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  ".rb": DEFAULT_LANGUAGE_ID,
  ".rake": DEFAULT_LANGUAGE_ID,
  ".gemspec": DEFAULT_LANGUAGE_ID,
};

const RUBY_LANGUAGE_CONFIG: LspLanguageConfig = {
  name: RubyLspConstants.BINARY_NAME,
  languageIdByExtension: LANGUAGE_ID_BY_EXTENSION,
  defaultLanguageId: DEFAULT_LANGUAGE_ID,
  resolveBinary: (workspaceRoot, override) =>
    resolvePathNativeBinary(
      {
        binaryName: RubyLspConstants.BINARY_NAME,
        defaultArgs: RubyLspConstants.DEFAULT_ARGS as unknown as string[],
      },
      override,
    ),
  checkPreflight: checkRubyLspPreflight,
  supportsQualifiedContainment: true,
  // issue #11 plan A: Ruby's own forward-resolution calibration slice hasn't run yet (Slice 4) --
  // stays on the reverse pipeline until it does (FWD-004/D2, single per-language safety gate).
  definitionResolution: "reverse",
};

/**
 * Ruby's `IEdgeResolutionProvider` -- all generic batch orchestration/reference-resolution logic
 * lives in `BaseLspEdgeProvider`.
 */
export class RubyLspEdgeProvider extends BaseLspEdgeProvider {
  constructor(logger?: ILogger, clientFactory?: () => LspJsonRpcClient) {
    super(RUBY_LANGUAGE_CONFIG, logger, clientFactory);
  }
}
