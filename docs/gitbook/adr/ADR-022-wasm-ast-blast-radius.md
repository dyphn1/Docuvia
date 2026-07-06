---
Date: 2026-07-02
Status: Accepted
Supplements: ADR-020
---

# ADR-022: WebAssembly AST for Git-Native Smart Blast Radius

## Status

Accepted

## Context

> **Implementation status:** Tracked in the roadmap, not here — see [Smart Blast Radius (WASM Semantic Diff)](../roadmap/features/smart-blast-radius-wasm-semantic-diff.md) in [Phase 2](../roadmap/phase-2-ast-microkernel-semantic-diffing.md).

Docuvia aims to be a Git-Native, Local-First knowledge extraction tool. Unlike heavy server-side indexing engines or tools that require starting a dedicated graph database (e.g., PostgreSQL or complex daemon processes), Docuvia needs to perform ultra-fast incremental updates (delta syncs) locally on developer machines.

When a file changes, naive graph implementations traverse and invalidate the entire upstream dependency chain, resulting in excessive LLM API calls and high CPU usage. We need a way to accurately determine if a file modification actually changes its "public contract" (signature) or if it's merely an internal implementation detail, thereby "pruning" the blast radius to zero when possible.

## Decision

We will adopt **`web-tree-sitter` (WASM AST)** as the core engine for Semantic Diffing and Blast Radius calculation, tightly coupled with the local Git object store.

The architecture involves three phases during a delta update:

1. **Diff-to-Node**: Map `git diff` line ranges to specific AST nodes in the new file.
2. **Semantic Pruning**: Parse the old file from Git (`git show HEAD`), and compare the modified node's signature against the new AST. If only the internal block/statements changed (Level 0), we prune the blast radius to 0. If the signature changed (Level 1), we proceed.
3. **Graph Traversal**: Query local SQLite or JSON graph edges to find upstream callers, extracting only the necessary nodes for LLM knowledge updates.

## Rationale

1. **Zero Native Build Toolchains**: `web-tree-sitter` compiles to WebAssembly. This allows the core parsing logic to run seamlessly across the CLI, the VS Code extension worker thread, and web interfaces, without requiring users to install C++ compilers (a major pain point in Python/Node native AST bindings).
2. **Microsecond Precision**: Parsing a single file and comparing two AST signatures takes milliseconds. This filters out the vast majority of non-breaking commits before they ever trigger a graph database lookup or LLM call.
3. **Git-Isomorphic Alignment**: This approach completely eliminates the need for an always-running backend database for local users, keeping the SSOT (Single Source of Truth) firmly on the `docuvia-knowledge` Git branch.

## Consequences

- **Positive**: Drastic reduction in LLM costs and local processing time for incremental updates. True "Local-First" feel.
- **Negative**: We must implement custom signature-comparison logic for each supported language (TypeScript, Python, etc.) within the `ast-core` package.
- **Negative**: WASM memory limits might require careful handling for exceptionally large files (though rare).
