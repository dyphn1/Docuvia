# Verification Report: Local Context Compression

- **Date**: 2026-06-26
- **Phase & Item**: Phase 8 — Local Context Compression
- **Target File**: `artifacts/api-server/src/lib/compression.ts`, `artifacts/api-server/src/routes/generate.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure

The `compressAstContext()` function is fully implemented in `artifacts/api-server/src/lib/compression.ts` (112 lines, correct pipeline: dedup → confidence-sort → truncate → budget-aware assembly). However, it is **never invoked in the production code path**:

1. `generate.ts:28` imports `compressAstContext` but **never calls it** — the import is dead.
2. Grep across the entire `artifacts/api-server/src/` tree confirms zero call sites for `compressAstContext`.
3. The same file exists as untracked copy at `artifacts/ast-core/src/compression.ts` (also unused).
4. No tests exist for the compression module.

This is the "orphaned implementation" pattern: a correct, well-typed utility that is completely disconnected from the live query pipeline. The generate route assembles AST context for LLM delivery without any compression step.

### Recommended Fix

1. **Wire into `generate.ts`**: In the document context assembly section (where AST nodes are collected before LLM delivery), call `compressAstContext()` with the assembled node list and a configured character budget.
2. **Remove dead import**: If wiring is deferred, remove the unused import at `generate.ts:28` to avoid TypeScript `noUnusedLocals` failures.
3. **Add unit tests**: Test `dedupNodes`, `sortByConfidence`, `assembleContext`, and `compressAstContext` with known inputs and expected outputs.
4. **Configuration**: Add compression settings (maxTotalChars, maxPerNodeChars) to environment config or project settings rather than relying on defaults.
