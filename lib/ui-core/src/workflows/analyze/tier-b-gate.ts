import {
  docuviaFactory,
  TOKENS,
  type EdgeResolutionAvailability,
  type EdgeResolutionProviderConfig,
  type ILogger,
} from "@workspace/contracts";

/**
 * D2's mandatory pre-flight gate for `init`/manual `analyze --escalate-to-lsp`
 * (phase1-decision-integration.md §8c) -- exposed to the Presentation layer through
 * `docuviaApi.checkTierBGate()` so the CLI can decide whether to prompt the user *before*
 * running the batch, without importing `lib/core`'s `checkLspPreflight` directly (Virtual
 * Contracts: only ui-core resolves Domain Core capabilities, always by token). Reuses the same
 * `IEdgeResolutionProvider.checkAvailability()` the batch itself calls for honest degradation --
 * one readiness check, two callers.
 */
export async function checkTierBGate(
  workspaceRoot: string,
  logger: ILogger,
  providerConfig?: EdgeResolutionProviderConfig,
): Promise<EdgeResolutionAvailability> {
  const buildProvider = docuviaFactory.resolve(TOKENS.EdgeResolutionProvider, {
    logger,
  });
  const provider = buildProvider();
  if (providerConfig) provider.configure(providerConfig);
  return provider.checkAvailability(workspaceRoot);
}
