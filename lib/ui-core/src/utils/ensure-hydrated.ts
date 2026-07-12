import { docuviaFactory, TOKENS, type ILogger } from "@workspace/contracts";
import { resolveDbPath } from "./resolve-db-path.js";

/**
 * Staleness-check auto-trigger (STOR-002) — called by every read-path workflow (`query`,
 * `impact`, `status`, `review`) before it opens its own readonly store, so a stale or missing
 * `local.db` self-heals without the user having to remember to run `docuvia hydrate` first.
 * Cheap when already up to date (one store open/close + a git log scan, no bulk load); runs a
 * full hydration only when `IHydrationService.isStale()` says the resolved knowledge commit has
 * moved since `local.db` was last hydrated, or `local.db` doesn't exist yet.
 *
 * Best-effort: if the store can't even be opened (e.g. a permissions issue), this silently
 * returns rather than throwing — the caller's own subsequent `openStore()` call surfaces the
 * same failure as a clearer `DB_OPEN_FAILED` `DocuviaError` with its usual "run docuvia init"
 * messaging, so there's no value in this helper throwing its own, less-specific error first.
 */
export async function ensureHydrated(workspaceRoot: string, logger: ILogger): Promise<void> {
  const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);

  let store;
  try {
    store = await openStore({ dbPath: resolveDbPath(workspaceRoot), readonly: false });
  } catch {
    return;
  }

  try {
    const hydrationService = docuviaFactory.resolve(TOKENS.HydrationService, { logger });
    if (await hydrationService.isStale(workspaceRoot, store)) {
      await hydrationService.hydrate(workspaceRoot, store);
    }
  } finally {
    await store.close();
  }
}
