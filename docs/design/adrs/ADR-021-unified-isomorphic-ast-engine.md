# ADR-021: Unified Isomorphic AST Engine

**Status:** Accepted
**Date:** 2026-06-22

## Context

In our pursuit of an Agentic OS Architecture with robust Git-Isomorphic graph capabilities, Docuvia requires reliable AST parsing to extract knowledge nodes. Historically, we approached this by maintaining two separate AST paradigms:

1. **Backend Bulk Parsing (ADR-009)**: Utilizing Node.js C++ bindings with `.jsonl` spools for high-throughput bulk ingestion.
2. **VS Code Local Parsing (ADR-020)**: Utilizing WASM bindings with IPC DTOs to meet local-first, zero-compilation extension requirements.

During rigorous architectural review, the SRE Challenger identified a critical vulnerability: maintaining two separate AST paradigms creates a high risk of divergence. Specifically, differences between C++ and WASM parsers—or variations in OS-level line endings (CRLF vs LF)—can result in divergent node hashing. This "split-brain" phenomenon leads to silent graph corruption, where the backend and the local extension disagree on a node's identity, thereby breaking incremental synchronization and the Agentic RAG router.

To mitigate this, the Challenger proposed standardizing on a single, isomorphic AST parsing core that guarantees deterministic hashing regardless of the execution environment.

## Decision

We will unify the parsing engine into a single shared monorepo package, `@workspace/ast-core`, and enforce a strict contract to prevent divergence.

1. **Exclusive use of `tree-sitter.wasm`**: We will deprecate and completely remove the C++ Node bindings for Tree-sitter. The new `@workspace/ast-core` package will rely exclusively on the `tree-sitter.wasm` bindings. This ensures both the Node.js backend and the VS Code extension execute identical parsing logic compiled to WebAssembly.
2. **Canonical Normalization & Hashing Contract**: To prevent cross-platform hashing collisions and avoid corrupting non-UTF8/binary files via blanket normalization, `@workspace/ast-core` will enforce a strict parsing funnel:
   - **Phase A: Identity Resolution Phase**: The pipeline MUST explicitly identify the target parser using a multi-layered approach:
     1. **Extension Mapping**: Standard extension allowlist (`.ts`, `.py`, etc.).
     2. **Header/Shebang Sniffing**: For extension-less files (common in Unix environments), read the first 256 bytes (magic bytes/shebang) to determine the language (e.g., `#!/usr/bin/env bash` routes to the Bash AST parser).
     3. **MIME Type Fallbacks**: Use MIME typing to confirm plaintext vs binary when extensions or headers are ambiguous.
        Unsupported or explicitly binary files without a valid parser identity are rejected immediately.
   - **Phase B: Binary Detection via Git Blob**: When a Git repository is present, use Git object metadata to determine if a blob is binary (e.g. `git diff` flags). If marked binary, skip parsing.
   - **Phase C: Lossless Encoding Guardrails**: If Git is absent, probe the file encoding. Only apply UTF-8 and LF normalization if the conversion is guaranteed lossless, or rely on the AST DTO structure for hashing instead of raw string manipulation.
   - **Phase D: LLM-Assisted Extension Discovery**: If a file passes Phase B and C (it is plain text and lossless) but its extension is not in the predefined AST Target Allowlist, do not silently drop it. Instead, dispatch a sample of the file to a background LLM worker to profile its language or framework. The LLM will record its signature and generate a "Grammar Request" to expand the allowlist, allowing the Agentic OS to adapt to newly invented file types over time.
3. **Pluggable Transport Sinks**: To accommodate the divergent I/O needs of the backend and the VS Code client, the core parser will operate purely as an in-memory stream/generator of AST nodes. We will implement environment-specific sinks:
   - `DiskJsonlSink`: An adapter used by the backend to spool bulk parsing results to disk via `.jsonl`.
   - `IpcSqliteSink`: An adapter used by the VS Code extension to pipe parsing results over IPC into local SQLite.

## Consequences

### Positive

- **Guaranteed Consistency**: By using exactly the same WASM binary and hashing contract, the backend and VS Code client will always generate identical hashes for identical code.
- **Data Integrity**: The strict parsing funnel prevents accidental corruption of binary and non-UTF8 assets during analysis.
- **Reduced Maintenance Surface**: We no longer need to maintain complex native C++ build chains, simplifying CI/CD pipelines and cross-platform compatibility.
- **Clear Architectural Boundaries**: `@workspace/ast-core` focuses strictly on parsing and hashing, cleanly delegating transport/storage to the Sinks.

### Negative

- **Minor Performance Overhead**: WASM parsing may have a slight performance penalty compared to native C++ bindings during bulk backend ingestion. However, this trade-off is strictly justified by the elimination of silent graph corruption.
- **Migration Effort**: Refactoring the existing backend ingestion pipeline to use WASM and the new `DiskJsonlSink` adapter will require a dedicated engineering effort.
- **Complexity in Git Integration**: Phase B requires tighter coupling with Git metadata during the analysis phase.
