---
Date: 2026-07-03
Status: Accepted
Supplements: ADR-015, ADR-022
---

# ADR-025: Hybrid Temp-File Blast Radius Overlay & Headless LSP

> **Implementation status:** Tracked in the roadmap, not here — see [Smart Blast Radius (WASM Semantic Diff)](../roadmap/features/smart-blast-radius-wasm-semantic-diff.md) and [Sub-second Incremental Watch](../roadmap/features/sub-second-incremental-watch.md) in [Phase 2](../roadmap/phase-2-ast-microkernel-semantic-diffing.md).

## Context

According to our SSOT (Single Source of Truth) principles, the `docuvia-knowledge` orphan branch is the absolute truth, and `local.db` is strictly a read-only projection of the current Git `HEAD`. However, developers and AI agents (via MCP) constantly modify code (unsaved buffers, unstaged edits). Writing these temporary, transient states to `local.db` would violate SSOT and cause database corruption (e.g., phantom nodes persisting after a `git reset --hard`).
Furthermore, while the VS Code extension can rely on the host's Language Servers (LSP) for semantic insights, Docuvia's CLI and standalone MCP servers run headlessly. They cannot access the VS Code editor's dirty buffers or LSP features.
A critical realization is that **storing all these continuous, high-frequency local changes purely in memory (RAM) is unsustainable**. Unbounded VFS memory caching leads to Node.js Out-Of-Memory (OOM) crashes, especially with large repositories or prolonged AI agent sessions.

## Decision

We will implement a **Hybrid Temp-File Blast Radius Overlay** backed by a **Headless LSP Manager**:

1. **Strict SSOT Database**: `local.db` never stores uncommitted or unsaved state. It remains an immutable projection of HEAD.
2. **Layered Dirty State Interception (Temp File + RAM Index)**:
   - **Payload Offloading (Branch-Isomorphic Format)**: Unsaved file contents and intermediate AST JSON structures are asynchronously flushed to temporary files on disk (e.g., `.docuvia/tmp/`). Crucially, **the format of these temporary files must perfectly match the Markdown/JSON schema used in the `docuvia-knowledge` orphan branch**. The Node.js process memory strictly holds lightweight indexes (URI -> Temp File Path, Version, Content Hash).
   - **Uncommitted (Staged/Unstaged)**: Processed by the local WASM AST engine via `git diff` asynchronously, writing AST structural deltas to temp storage in the exact format expected by the final commit.
   - **Unsaved (Dirty Buffers)**: Managed by the **Headless LSP Client Manager**. It uses the lightweight RAM index to route `textDocument/didChange` events (reading payload from temp files) to standalone child LSP processes (e.g., `tsserver`, `pyright`).
3. **Hybrid Traversal (Async Resolution)**: The query layer implements a `VirtualGraphContext`. It asynchronously merges the pre-computed dirty nodes (from temp storage) over the read-only `local.db` edges. This keeps the memory footprint flat while providing a real-time blast radius.
4. **Shared Library Extraction (`@workspace/headless-lsp`)**: To satisfy Hexagonal Architecture boundaries (ADR-021), the entire VFS and Headless LSP logic must reside in a dedicated shared library (`lib/headless-lsp`), preventing artifact-to-artifact dependencies and allowing both the CLI and API server to seamlessly spawn standalone LSPs.

## Consequences

- **Positive**: Absolute data integrity for `local.db`. No corrupted phantom states or locks during active typing.
- **Positive**: Flat memory footprint. By offloading bulky source text and AST structures to local temp files, the system avoids OOM crashes during long or rapid coding sessions.
- **Positive**: Seamless Promotion (Zero-Cost Ingestion). Because temp files share the exact format as the orphan branch, committing the changes allows the ingestion pipeline to reuse or directly promote the temp files, bypassing expensive re-parsing.
- **Positive**: MCP agents and CI pipelines gain full semantic resolution capabilities (via Headless LSP) natively.
- **Negative**: High architectural complexity. The backend must orchestrate asynchronous temp file I/O, child process lifetimes, and garbage collect stale temp files.
