/**
 * Curated public barrel for `@workspace/core`. Importing this module (for its `./register.js`
 * side effect) is how the Presentation layer triggers Domain Core registration — `lib/ui-core`
 * never imports this package at all, only `docuviaFactory` by token, per
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Orchestration Layer section
 * ("it only knows the workflows"). The one exception is `UTF8_ENCODING`, a plain string
 * constant the Presentation layer (`artifacts/cli`) already reads directly for its own file
 * writes.
 */
import "./register.js";

export { UTF8_ENCODING } from "./constants/encoding.js";
