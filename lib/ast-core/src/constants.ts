/**
 * Re-export shim (Virtual Contracts §8 — shared definitions must live in contracts): the
 * single source of truth for `SUPPORTED_LANGUAGES` / `SupportedLanguage` moved to
 * `@workspace/contracts` so `lib/core` / `lib/plugins-ast` can reference them without
 * importing the tree-sitter tech-provider package. This file keeps ast-core's own public
 * API unchanged (existing consumers can keep importing from `@workspace/ast-core`).
 */
export { SUPPORTED_LANGUAGES } from "@workspace/contracts";
export type { SupportedLanguage } from "@workspace/contracts";
