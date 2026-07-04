> **Note:** This document contains competitor analysis and references that have not been fully integrated into the current implementation yet.
>
> **SUPERSEDED:** This fallback strategy contradicts [ADR-020](../adr/ADR-020-unified-isomorphic-ast-microkernel.md), which explicitly mandates pure WASM parsing to prevent cross-platform hash divergence. This document is retained for historical evaluation context, but the codebase correctly follows ADR-020.

# 05. Native Parsing Fallback

**Severity:** 🟠 HIGH
**Domain:** Parsing Performance
**Target:** `@workspace/ast-core`

## Deficit Description

ADR-020 mandated pure WASM parsing (`web-tree-sitter`) to prevent cross-platform hash divergence. However, WASM is significantly slower than native C++ implementations. In massive legacy codebases, the initial AST scan will cause CPU spikes and unacceptable execution times. Competitors like `GitNexus` solve this by defaulting to high-speed Native C++ bindings and gracefully falling back to WASM only when binaries are unavailable.

## Acceptance Criteria

1. Modify `@workspace/ast-core` to attempt to load native `tree-sitter` and language bindings (`tree-sitter-typescript`, etc.) first.
2. If native bindings fail to load (e.g., inside the VS Code Extension Host or unsupported architectures), automatically fallback to `web-tree-sitter` (WASM).
3. Ensure AST hashing remains deterministic regardless of the underlying execution engine.
