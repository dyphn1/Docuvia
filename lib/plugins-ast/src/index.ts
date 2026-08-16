/**
 * Backward-compatible re-export shim (issue #117/#118): the per-language configs and the
 * default registry now live in `@workspace/ast-core` — the package `lib/core` is allowed to
 * depend on — because the AST worker thread (which can't resolve `docuviaFactory` tokens)
 * constructs the registry via a static import. This package is retained so existing importers
 * of `@workspace/plugins-ast` keep resolving; new code should import from `@workspace/ast-core`.
 */
export {
  DEFAULT_REGISTRY,
  loadDefaultRegistry,
  loadDefaultRegistryFromString,
} from "@workspace/ast-core";
export * from "./languages/index.js";