import {
  docuviaFactory,
  TOKENS,
  type EdgeResolutionAvailability,
  type EdgeResolutionProviderConfig,
  type IGraphStore,
  type ILogger,
  type TierBLanguageId,
} from "@workspace/contracts";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { readTierBQueue } from "./tier-b-queue.js";
import { dispatchTierBLanguage } from "./tier-b-language-dispatch.js";

/**
 * D2's mandatory pre-flight gate for `init`/manual `analyze --escalate-to-lsp`
 * (phase1-decision-integration.md §8c) -- exposed to the Presentation layer through
 * `docuviaApi.checkTierBGate()` so the CLI can decide whether to prompt the user *before*
 * running the batch, without importing `lib/core`'s `checkLspPreflight` directly (Virtual
 * Contracts: only ui-core resolves Domain Core capabilities, always by token). Reuses the same
 * `IEdgeResolutionProvider.checkAvailability()` the batch itself calls for honest degradation --
 * one readiness check, two callers.
 *
 * multi-language-lsp-support plan, Finding A/G, resolved by roadmap Item 17
 * (`implement_tier-b-gate-scoped-to-queue.md`): scopes the availability check to only the
 * language(s) actually present in the current `tierBQueue`, rather than every registered
 * language in `TOKENS.EdgeResolutionProviders`. Falls back to checking the whole registry when
 * the queue can't be determined (see `resolveQueuedLanguages()`).
 */
export async function checkTierBGate(
  workspaceRoot: string,
  logger: ILogger,
  providerConfig?: EdgeResolutionProviderConfig,
): Promise<EdgeResolutionAvailability> {
  const registry = docuviaFactory.resolve(TOKENS.EdgeResolutionProviders, {
    logger,
  });

  const languagesToCheck = await resolveQueuedLanguages(
    workspaceRoot,
    registry,
  );

  const unavailable: EdgeResolutionAvailability[] = [];
  for (const languageId of languagesToCheck) {
    const buildProvider = registry[languageId];
    if (!buildProvider) continue;
    const provider = buildProvider();
    if (providerConfig) provider.configure(providerConfig);
    const availability = await provider.checkAvailability(workspaceRoot);
    if (!availability.available) unavailable.push(availability);
  }

  if (unavailable.length === 0) return { available: true };
  if (languagesToCheck.length > 0 && unavailable.length === languagesToCheck.length) {
    if (unavailable.length === 1) return unavailable[0];
    return {
      available: false,
      reason: unavailable.map((a) => a.reason ?? "").join("; "),
    };
  }
  return { available: true };
}

/**
 * Finding G: scopes the gate to only the language(s) actually queued for the next Tier B batch,
 * instead of every registered language. Falls back to the full registry (pre-Finding-G behavior)
 * when the queue genuinely can't be determined (no `GraphStoreOpener` registered, or the store
 * can't be opened) -- a deliberately conservative default, distinct from a real empty-queue
 * result (which returns `[]` and correctly no-ops, mirroring `runTierBBatchCore`'s own
 * empty-queue short-circuit).
 *
 * Exported for `doctor-workflow.ts`'s LSP-binary diagnostic (§10e bullet 4 / §7a-1, T8), which
 * reuses this exact scoping so a project with several registered language providers isn't failed
 * over a language it doesn't actually use (e.g. a TypeScript-only repo failing doctor because
 * csharp-ls isn't installed) -- same reasoning as this gate's own Finding G.
 */
export async function resolveQueuedLanguages(
  workspaceRoot: string,
  registry: Partial<Record<TierBLanguageId, () => unknown>>,
): Promise<TierBLanguageId[]> {
  if (!docuviaFactory.has(TOKENS.GraphStoreOpener)) {
    return Object.keys(registry) as TierBLanguageId[];
  }

  let store: IGraphStore | undefined;
  try {
    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    store = await openStore({
      dbPath: resolveDbPath(workspaceRoot),
      readonly: true,
    });

    const queue = readTierBQueue(store);
    const queuedLanguages = new Set<TierBLanguageId>();
    for (const entry of queue) {
      const languageId = dispatchTierBLanguage(entry.file);
      if (languageId) queuedLanguages.add(languageId);
    }
    return Array.from(queuedLanguages);
  } catch (err) {
    console.error("resolveQueuedLanguages error:", err);
    return Object.keys(registry) as TierBLanguageId[];
  } finally {
    await store?.close();
  }
}
