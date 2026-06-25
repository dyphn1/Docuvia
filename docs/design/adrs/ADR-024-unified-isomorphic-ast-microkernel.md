# ADR-024: Unified Isomorphic AST Microkernel

## Status

Accepted (2026-06-25)
*Note: This document consolidates, supersedes, and replaces ADRs 014, 020, 021, and 022 after a 10-round adversarial architectural review.*

## Context

Docuvia requires blazing-fast, structural code analysis (AST) to generate the Agentic RAG Knowledge Graph without relying on expensive Language Servers (LSP) or incurring LLM token costs. Historically, our architecture suffered from extreme fragmentation:
1. We debated C++ vs. WASM bindings, risking a "split-brain" hashing bug where the Backend and VS Code Client produced different node hashes.
2. We struggled with bundle size limits for the VS Code extension if we monolithicly packaged 30+ parsers.
3. We faced OOM (Out Of Memory) crashes in VS Code due to unmanaged WASM C++ heap allocations (`tree-sitter` memory leaks).

## Decision

We unify the entire AST architecture under the **Unified Isomorphic AST Microkernel** paradigm, defined by four non-negotiable pillars:

### 1. Isomorphic WASM-Only Parsing
To eliminate "split-brain" graph divergence, **C++ native bindings are strictly banned**. Both the Node.js API Server and the VS Code Client will exclusively use the WebAssembly (`web-tree-sitter`) engine. A single file parsed on the backend or the frontend must mathematically yield the exact same AST structure and SHA-256 hash.

### 2. Microkernel & Dynamic Plugin Ecosystem
The core engine (`@workspace/ast-core`) will act as a lightweight Microkernel. It will contain zero language-specific grammars. Languages will be separated into isolated plugin packages (e.g., `@workspace/plugin-ast-typescript`). The Microkernel dynamically lazy-loads only the `.wasm` grammars present in the user's current repository, keeping the extension startup time sub-second and the base memory footprint minimal.

### 3. Strict Worker Thread Isolation
WASM heap memory must be manually freed (`tree.delete()`). To prevent memory leaks from crashing the VS Code Extension Host or the main API Server, all AST parsing **must** execute inside isolated `worker_threads` (or Web Workers). If a worker OOMs or hangs on a malicious file, the Microkernel simply terminates the worker, flags the file as failed, and spawns a new worker.

### 4. Zero-LLM Database-as-IPC Pipeline
To completely bypass IPC (Inter-Process Communication) serialization overhead between the Worker and the Main Thread, we inherit the decision from **ADR-015 (Database-as-IPC)**. The isolated AST Worker handles parsing, traversing, and extracting structural metadata, and then **directly writes `GraphNode` and `GraphEdge` rows into the local SQLite database**. The main thread only sends small control signals (e.g., "parse src/auth.ts") and queries the SQLite database natively. This constitutes a purely local, Zero-LLM pipeline that costs $0.00 to execute while keeping IPC payloads negligible.

## Consequences

- **Positive:** Guaranteed 100% hash parity between local IDE graphs and server-side databases (Git-Isomorphic sync is safe).
- **Positive:** VS Code Extension bundle size remains under 5MB.
- **Positive:** Complete immunity to IDE freezing or crashes caused by AST parsing.
- **Positive:** IPC serialization bottlenecks are eliminated via direct SQLite writes by the worker (Database-as-IPC).
- **Negative:** WASM is ~20-30% slower than native C++ bindings for massive bulk ingestion on the server.
- **Negative:** Increased architectural complexity in managing a dynamic Web Worker pool and ensuring safe concurrent SQLite writes from workers.
