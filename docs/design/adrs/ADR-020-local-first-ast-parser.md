# ADR 020: Local-First AST Parser Architecture for VS Code Client

## Status

Accepted (Revised for Hybrid I/O & Content-Addressed Caching)

## Context

Docuvia relies heavily on AST parsing (via `web-tree-sitter`) to generate accurate structural metadata for our Knowledge Graph. Currently, the AST logic resides in the backend (`api-server`) using Node.js `worker_threads` (Piscina) and native `node:fs`.

To support a **Local-First** topology scan within the VS Code Extension (`vscode-client`), we must port the AST parsing locally. However, we cannot simply reuse the server-side implementation because:

1. VS Code Extension Hosts are strictly single-threaded; synchronous heavy CPU parsing will freeze the UI.
2. Extensions must support Web (`vscode.dev`) and Remote environments where Node.js built-ins (`worker_threads`, `fs`) are unavailable or unreliable.
3. Tree-sitter WASM modules require explicit C++ heap memory management (`delete()`), which, if leaked, will cause the Extension Host to OOM.
4. Bundlers like `esbuild` break relative WASM paths when packaging an extension.
5. **Performance Bottleneck:** Passing the full content of large files via IPC (`postMessage`) from the Main Thread to a Web Worker is highly inefficient due to string serialization/deserialization overhead.
6. **Redundant Parsing:** Parsing the exact same file content multiple times across sessions or branch switches wastes CPU cycles.

## Decision

We will implement a resilient, **Hybrid I/O**, Local-First AST parser inside `vscode-client` based on the following architectural rules:

1. **Pre-Worker Content-Addressed Caching (O(1) Bypass)**:
   Before the Main Thread ever spawns or messages a Worker, it must verify if the file has already been parsed. Aligning with ADR-017, we implement a two-tier hashing strategy:
   - **Tier A (Git Environments):** Use `git ls-files -s <file>` to retrieve the Git Blob Hash.
   - **Tier B (Non-Git Environments):** Calculate a fast local hash (e.g., `SHA-256` or `xxhash`) of the file content.
     If the AST payload for this Hash already exists in the local Knowledge Graph / Cache, **bypass the Worker entirely** and load the cached result.

2. **Web Workers over Node.js Workers**:
   We will use standard browser Web Workers (`new Worker()`) for background processing. This ensures out-of-the-box compatibility with VS Code Web and Remote extensions.

3. **Hybrid I/O Boundary (IPC Optimization)**:
   If a cache MISS occurs, the file must be parsed. We prevent massive IPC overhead using a dual-path I/O strategy:
   - **Path A (Local Optimization):** If the environment is Desktop (`vscode.env.uiKind === vscode.UIKind.Desktop`) AND the file URI scheme is `file://`, the Main Thread sends **only the absolute file path and the Hash** via IPC. The Web Worker then dynamically imports `node:fs/promises` and reads the file directly from disk.
   - **Path B (Remote/Virtual Fallback):** If the URI scheme is virtual (e.g., `vscode-vfs://`, `ssh://`) or the extension is running in a Web environment, the Main Thread reads the file using `vscode.workspace.fs.readFile()` and passes the raw string and Hash via IPC.

4. **Minimal DTO IPC Return & SQLite Caching**:
   We will NOT use file-based caching (e.g., `.docuvia/cache/<hash>.json`) for parsed AST outputs. Instead:
   - **Worker Side**: The Worker parses the AST but never attempts to serialize the raw tree. It extracts a strictly minimal Semantic JSON DTO containing only L2/L3 Node structures and edges. Because the DTO is orders of magnitude smaller than a raw AST, passing it back via `postMessage` is safe and will not block V8's Structured Clone.
   - **Main Thread Side**: The Main Thread receives the minimal DTO and inserts it directly into the local SQLite database alongside its content hash.
   - **Reasoning**: This maintains a single source of truth (SQLite), prevents cache-file littering, and prevents SQLite file locking conflicts by keeping all database writes in the Main Thread.

5. **Explicit WASM Memory Lifecycle**:
   Every Tree-sitter parsing and querying operation inside the Worker must be wrapped in a `try...finally` block that explicitly calls `tree.delete()` and `query.delete()`. This guarantees the WASM memory buffer is flushed, preventing memory leaks.

6. **External WASM Asset Bundling**:
   The `web-tree-sitter.wasm` and language grammars will be excluded from the `esbuild` bundle. A post-build script will copy these assets into a flat `dist/wasm/` directory. At runtime, the Main Thread will resolve the absolute URI via `vscode.Uri.joinPath` and pass it to the Worker for initialization.

## Consequences

- **Positive**: We achieve robust, non-blocking AST parsing without freezing the UI.
- **Positive**: The $O(1)$ Hash bypass and Hybrid I/O optimizations save massive amounts of memory and CPU time, bringing enterprise-grade parsing performance to the VS Code client.
- **Negative**: Adds branching logic to the Worker execution (handling both direct `fs` reads and IPC payloads), and requires careful bundler configuration so that `node:fs` isn't polyfilled/broken for the Worker script.
