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
 *
 * Plain constants and pure helpers that `lib/ui-core`/`artifacts/cli` also need (e.g.
 * `GitConstants`, `parseSourceTrailer`, `CURRENT_NODE_KEY_FORMAT_VERSION`, the hooks-dir paths)
 * used to be exported here too but have moved to `@workspace/contracts` (issue #30) — only
 * helpers coupled to the language registry or to git/store IO remain exceptions.
 */
import "./register.js";

export {
  isSupportedSourceFile,
  isDiscoverableSourceFile,
} from "./utils/language-detection.js";
// L3 distribution (phase2-l3-distribution.md): `renderL3Card`/`computeL2GitPathsByNodeId` are
// pure, side-effect-free rendering helpers `SnapshotWorkflow` calls directly, the same "narrow
// exception" precedent as `isSupportedSourceFile` above.
export {
  renderL3Card,
  computeL2GitPathsByNodeId,
} from "./git/l3-card-renderer.js";
