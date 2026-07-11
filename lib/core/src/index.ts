/**
 * Curated public barrel for `@workspace/core`. Importing this module (for its `./register.js`
 * side effect) is how the Presentation layer triggers Domain Core registration — `lib/ui-core`
 * never imports this package at all, only `docuviaFactory` by token, per
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Orchestration Layer section
 * ("it only knows the workflows"). `artifacts/cli` must never import this package directly for
 * anything else — plain constants it needs (e.g. `UTF8_ENCODING`) live in `@workspace/contracts`
 * instead, which both `lib/core` and `artifacts/cli` are allowed to depend on.
 */
import "./register.js";
