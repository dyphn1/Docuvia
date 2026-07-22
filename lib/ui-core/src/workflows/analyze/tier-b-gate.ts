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
 *
 * multi-language-lsp-support plan, Finding A/G: resolves the whole `TOKENS.EdgeResolutionProviders`
 * registry and checks every registered language's availability, not just one. Slice 0's registry
 * only ever has `typescript`, so this is byte-identical to the old single-provider check in
 * practice; the loop is what makes it correct once a second language's provider registers. Finding
 * G's fuller "only gate languages actually present in the current `tierBQueue`" refinement is
 * deferred to whichever slice first needs it -- doing it now would mean this gate reading the
 * queue (a `GraphStoreOpener` round trip this Slice 0 call site doesn't have plumbed in), which is
 * out of scope for a slice that must be a zero-behavior-change refactor.
 */
export async function checkTierBGate(
  workspaceRoot: string,
  logger: ILogger,
  providerConfig?: EdgeResolutionProviderConfig,
): Promise<EdgeResolutionAvailability> {
  const registry = docuviaFactory.resolve(TOKENS.EdgeResolutionProviders, {
    logger,
  });

  const unavailable: EdgeResolutionAvailability[] = [];
  for (const buildProvider of Object.values(registry)) {
    if (!buildProvider) continue;
    const provider = buildProvider();
    if (providerConfig) provider.configure(providerConfig);
    const availability = await provider.checkAvailability(workspaceRoot);
    if (!availability.available) unavailable.push(availability);
  }

  if (unavailable.length === 0) return { available: true };
  if (unavailable.length === 1) return unavailable[0];
  return {
    available: false,
    reason: unavailable.map((a) => a.reason ?? "").join("; "),
  };
}
