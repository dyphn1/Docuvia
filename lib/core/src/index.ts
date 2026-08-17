/**
 * Curated public barrel for `@workspace/core`. Importing this module (for its `./register.js`
 * side effect) is how the Presentation layer triggers Domain Core registration — `lib/ui-core`
 * otherwise never imports this package, only `docuviaFactory` by token, per
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Orchestration Layer section
 * ("it only knows the workflows"). `artifacts/cli` must never import this package directly for
 * anything else — plain constants it needs (e.g. `UTF8_ENCODING`) live in `@workspace/contracts`
 * instead, which both `lib/core` and `artifacts/cli` are allowed to depend on.
 *
 * A handful of narrow, deliberate exceptions below: pure, side-effect-free domain knowledge, not
 * a swappable technology and not DI-registered behind a token (see
 * `lib/ui-core/src/workflows/analyze/decision-extraction.ts`'s Decision 2 writeup for
 * `isSupportedSourceFile`'s original precedent) — `lib/ui-core`'s file-walks reuse these directly
 * rather than re-implementing them, which would drift from `lib/core`'s own source of truth.
 */
import "./register.js";

export {
  isSupportedSourceFile,
  isDiscoverableSourceFile,
} from "./utils/language-detection.js";
export { MAX_FILE_SIZE_BYTES } from "./constants/paths.js";
export { GitConstants } from "./git/git-constants.js";
export { parseSourceTrailer } from "./git/git-trailers.js";
// GRPH-006's format-version stamp: pure, side-effect-free domain knowledge (same "narrow
// exception" precedent as `isSupportedSourceFile` above) that `lib/ui-core`'s
// `stamp-full-ingestion-for-tier-b.ts`/`node-key-format-guard.ts` need to read/write the
// `docuvia_meta` stamp -- not DI-registered behind a token, so it's exported here directly.
export { CURRENT_NODE_KEY_FORMAT_VERSION } from "./graph/node-key.js";
// L3 distribution (phase2-l3-distribution.md): `renderL3Card`/`computeL2GitPathsByNodeId` are
// pure, side-effect-free rendering helpers `SnapshotWorkflow` calls directly, the same "narrow
// exception" precedent as `isSupportedSourceFile` above. `importL3CardsFromKnowledgeBranch` does
// take `IGitProvider`/`IGraphStore` params, but — like those two — never resolves them itself
// (the caller already has them via `docuviaFactory`); exporting it here is what lets
// `sync-knowledge`'s workflow reuse `HydrationService.hydrate()`'s exact same L3-import logic
// (L3DIST-007's §3 wiring) instead of duplicating it.
export {
  renderL3Card,
  computeL2GitPathsByNodeId,
} from "./git/l3-card-renderer.js";
export { importL3CardsFromKnowledgeBranch } from "./git/l3-import.service.js";
// §5.3/§5.7 item 2's Tier B coverage hint (typescript-cli-benchmark.md): pure store-read helper
// reused by both `QueryService.getContext()` (lib/core, relative import) and `ImpactWorkflow`
// (lib/ui-core) -- same "narrow exception" precedent as `importL3CardsFromKnowledgeBranch` above
// (takes `IGraphStore` as a param, never resolves it itself).
export { resolveTierBCoverageHint } from "./graph/tier-b-coverage.js";
