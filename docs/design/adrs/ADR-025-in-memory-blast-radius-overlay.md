---
Date: 2026-07-03
Status: Accepted
Supplements: ADR-015, ADR-022
---

# ADR-025: In-Memory Blast Radius Overlay & Headless LSP

## Context

According to our SSOT (Single Source of Truth) principles, the `docuvia-knowledge` orphan branch is the absolute truth, and `local.db` is strictly a read-only projection of the current Git `HEAD`. However, developers and AI agents (via MCP) constantly modify code (unsaved buffers, unstaged edits). Writing these temporary, transient states to `local.db` would violate SSOT and cause database corruption (e.g., phantom nodes persisting after a `git reset --hard`).
Furthermore, while the VS Code extension can rely on the host's Language Servers (LSP) for semantic insights, Docuvia's CLI and standalone MCP servers run headlessly. They cannot access the VS Code editor's dirty buffers or LSP features.

## Decision

We will implement an **In-Memory Blast Radius Overlay** backed by a **Headless LSP Manager**:

1. **Strict SSOT Database**: `local.db` never stores uncommitted or unsaved state. It remains an immutable projection of HEAD.
2. **Layered Dirty State Interception**:
   - **Uncommitted (Staged/Unstaged)**: Processed by the local WASM AST engine (Tree-sitter) via `git diff` to identify structural signature changes (as per ADR-022).
   - **Unsaved (Dirty Buffers)**: Managed by a newly introduced **Headless LSP Client Manager**. The Docuvia backend will spawn and manage standard LSPs (e.g., `tsserver`, `pyright`) as child processes via stdio JSON-RPC. It maintains a Virtual File System (VFS) to broadcast `textDocument/didChange` events, feeding dirty state to the LSP independently of any IDE.
3. **Hybrid Traversal (In-Memory Patching)**: The query layer will implement a `VirtualGraphContext`. It queries the dirty nodes from the WASM AST or Headless LSP, and then performs an in-memory traversal over the read-only `local.db` edges. The result is a unified, real-time blast radius computed entirely in RAM.

## Consequences

- **Positive**: Absolute data integrity for `local.db`. No corrupted phantom states or locks during active typing.
- **Positive**: MCP agents and CI pipelines gain full semantic resolution capabilities (via Headless LSP) without needing a VS Code host, making Docuvia a true standalone Intelligence Server.
- **Negative**: High architectural complexity. The backend must orchestrate child process lifetimes, handle JSON-RPC messaging, and manage VFS state.
- **Negative**: High memory consumption for spawning LSPs headlessly. Requires strict idle timeouts and resource limits, with graceful fallbacks to the pure AST engine.
