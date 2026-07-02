# AST Semantic Diff & Blast Radius (WASM-based)

This document outlines the architecture and algorithm for Docuvia's "Smart Blast Radius" and semantic diff detection using `web-tree-sitter` (WASM AST). This strategy is the cornerstone of our Git-Native, Local-First architecture, designed to drastically outperform heavy indexing solutions (like GitNexus) in incremental update (Delta) scenarios.

## 1. Core Concept: Git-Isomorphic & Smart Pruning

Instead of maintaining a heavy, always-running graph database, Docuvia treats the Git branch (`docuvia-knowledge`) as the Single Source of Truth (SSOT).
When files change, we do **not** blindly invalidate all dependencies. Instead, we use `web-tree-sitter` to compare the old and new ASTs. If the change is purely internal (e.g., changing a local variable), we **prune** the blast radius to zero. We only trigger cross-file updates when the public contract (signature) of a symbol changes.

## 2. Algorithm Workflow

The algorithm consists of three distinct phases executed upon detecting a `git diff`.

### Phase 1: Rapid Diff to Node Localization (Diff-to-Node)

- **Input**: Line ranges from `git diff --unified=0 HEAD`.
- **Action**:
  1. Parse the _new_ file content using `web-tree-sitter`.
  2. Map the changed line numbers to specific named AST nodes (e.g., `function_declaration`, `method_definition`, `class_declaration`).
- **Output**: A precise list of modified symbols (e.g., `src/api.ts::fetchData`).

### Phase 2: AST Semantic Diffing & Smart Pruning (The Secret Weapon)

- **Action**:
  1. Retrieve the _old_ file content from Git (`git show HEAD:<file>`).
  2. Parse the old file with `web-tree-sitter`.
  3. Compare the specific modified node (from Phase 1) between the old and new ASTs.
- **Pruning Logic**:
  - **[Level 0: Internal Implementation Change]**: If the changes are strictly confined within the `statement_block` (the body of the function/method), and the signature (name, parameters, return type, JSDoc) remains identical.
    - 👉 **Result: Blast Radius = 0**. Only the node itself needs an updated summary. Upstream dependencies are ignored.
  - **[Level 1: Interface / Contract Change]**: If parameters are added/removed, return types change, or export visibility is modified.
    - 👉 **Result: Trigger Diffusion**. Proceed to Phase 3.

### Phase 3: Graph Traversal & Delta Update (Blast Radius Diffusion)

- **Action**:
  1. For nodes flagged as Level 1 changes, query the existing `Edges` cache (stored in local SQLite or JSON files on the `docuvia-knowledge` branch).
  2. Traverse reverse dependencies: Find all nodes that have a `CALLS` or `IMPORTS` edge pointing to the changed node.
  3. Collect these affected upstream nodes to form the complete "Blast Radius Scope".
  4. Dispatch only this localized scope for LLM re-evaluation or knowledge graph updating.
  5. Commit the updated JSON representations back to the `docuvia-knowledge` branch.

## 3. Advantages over Competitors

1. **Zero Native Dependencies**: By utilizing `web-tree-sitter` (WASM), the entire process runs anywhere (CLI, VS Code extension, Web) without requiring local C++ toolchains.
2. **Microsecond Precision**: AST comparisons filter out 80%+ of typical commits (which are mostly internal logic changes) before ever touching the dependency graph or hitting LLM APIs.
3. **True Local-First**: Relies entirely on the local Git object store and lightweight local graph caches.

## 4. Implementation Next Steps

- Create `SemanticDiffDetector` in `artifacts/ast-core/src/detector/semantic-diff.ts`.
- Implement tree-sitter query extraction for function signatures in TypeScript/JavaScript.
- Build a proof-of-concept integrating `git diff` with AST node mapping.
