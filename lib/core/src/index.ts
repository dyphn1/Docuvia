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
export {
  MAX_FILE_SIZE_BYTES,
  CLAUDE_HOOKS_DIR,
  CURSOR_HOOKS_DIR,
  DOCUVIA_HOOK_JS_FILENAME,
  DOCUVIA_HOOK_CJS_FILENAME,
} from "./constants/paths.js";
export { GitConstants } from "./git/git-constants.js";
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
