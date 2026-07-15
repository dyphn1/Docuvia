/**
 * Curated public barrel for `@workspace/core`. Importing this module (for its `./register.js`
 * side effect) is how the Presentation layer triggers Domain Core registration — `lib/ui-core`
 * otherwise never imports this package, only `docuviaFactory` by token, per
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Orchestration Layer section
 * ("it only knows the workflows"). `artifacts/cli` must never import this package directly for
 * anything else — plain constants it needs (e.g. `UTF8_ENCODING`) live in `@workspace/contracts`
 * instead, which both `lib/core` and `artifacts/cli` are allowed to depend on.
 *
 * One narrow, deliberate exception: `isSupportedSourceFile` below. It is pure, side-effect-free
 * "which file extensions count as source code" domain knowledge, not a swappable technology and
 * not DI-registered behind a token (see `lib/ui-core/src/workflows/analyze/decision-extraction.ts`'s
 * Decision 2 writeup) — `lib/ui-core`'s decision-extraction file-walk reuses it directly rather
 * than re-implementing the extension table, which would drift from the AST layer's own registry.
 */
import "./register.js";

export { isSupportedSourceFile } from "./utils/language-detection.js";
