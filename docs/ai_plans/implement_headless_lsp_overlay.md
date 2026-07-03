# Headless LSP In-Memory Overlay

## 5-Round Architectural Debate

**Round 1: Requirement Analyzer**
"We have a critical gap in our architecture. Currently, Docuvia assumes it can lean on VS Code's language servers for dirty state tracking and semantic resolution. However, Docuvia's CLI and MCP servers often run headlessly—like in CI pipelines, Docker containers, or standalone terminals. Without the VS Code editor host, we have no LSP. How do we orchestrate a Headless LSP to feed an 'In-Memory Overlay' so that our MCP agents can reason about unsaved, dirty code?"

**Round 2: Backend Developer**
"To solve this, our API/MCP server needs to act as an *LSP Client*. We can spawn standalone LSP binaries (like `typescript-language-server`, `pyright`, or `rust-analyzer`) as child processes using standard `stdio`. The 'In-Memory Overlay' would be a Virtual File System (VFS) state kept in the Docuvia backend. When an AI or headless client modifies a file, we intercept that change and send standard `textDocument/didOpen` and `textDocument/didChange` JSON-RPC notifications to the spawned LSP. This keeps the LSP's AST perfectly in sync with our dirty state."

**Round 3: API Architect**
"I agree with the client-server relationship, but we need to consider lifecycle and resource management. LSPs are incredibly memory-hungry and can take a while to initialize. If an AI agent makes rapid, successive edits across multiple languages, spawning LSPs on the fly will cause massive latency and OOM errors. Furthermore, what happens if the environment doesn't even have `pyright` or `tsserver` installed? We can't let the entire MCP server crash."

**Round 4: Backend Developer**
"Good point on resources. We should implement an `LspClientManager` with a connection pool and idle timeouts. If an LSP isn't used for 10 minutes, we gracefully shut it down via `shutdown` and `exit` requests. For the missing dependencies issue, we must treat the Semantic LSP layer as an *enhancement*, not a hard requirement. If the binary is missing or fails to spawn, we fallback to our local Tree-sitter implementation. Tree-sitter gives us a robust, zero-dependency, syntactic-only overlay. We lose deep type inference, but we keep the ability to parse dirty code."

**Round 5: Requirement Analyzer**
"This sounds like a solid, resilient architecture. To summarize: We build an `LspClientManager` that orchestrates child LSP processes via JSON-RPC over stdio. It maintains a Virtual File System (VFS) to track dirty buffers and synchronizes them using `didChange` events. If an LSP is unavailable or crashes, we seamlessly degrade to our Tree-sitter AST engine. This ensures the Knowledge Graph and MCP tools always have access to the latest code state, completely independent of VS Code."

---

## Final Architectural Consensus

Docuvia will implement its own headless LSP client to manage dirty states and provide semantic code intelligence to MCP tools without relying on a host editor like VS Code.

1. **LSP Client Manager (`LspClientManager`)**: A dedicated service in the `api-server` that spawns and manages child LSP processes (e.g., `tsserver`, `pyright`) via `stdio` JSON-RPC.
2. **In-Memory Overlay (VFS)**: A virtual file system layer that tracks unsaved edits. It acts as the source of truth for dirty files and broadcasts `textDocument/didChange` events to the active LSPs.
3. **Graceful Degradation**: If an environment lacks the required LSP binaries, or if resource constraints prevent spawning them, Docuvia will fallback to its internal **Tree-sitter AST parser**. Tree-sitter will maintain the syntactic overlay, ensuring continuity for structural queries even without semantic type inference.
4. **Lifecycle Management**: LSPs will be managed with idle timeouts and memory circuit breakers to prevent runaway resource consumption in headless environments.

---

## Implementation Goals

- **Goal 1**: Create a Node.js-based JSON-RPC client capable of spawning and communicating with standard LSPs via `stdio`. (Verifiable when we can successfully spawn `typescript-language-server` and receive an `initialize` response).
- **Goal 2**: Implement the `VirtualFileSystem` to hold dirty file buffers in memory. (Verifiable when a `file_update` event correctly updates the buffer in memory).
- **Goal 3**: Wire the VFS to the `LspClientManager` to automatically dispatch `textDocument/didChange` notifications upon buffer updates. (Verifiable via LSP diagnostic logs acknowledging the dirty state).
- **Goal 4**: Implement the fallback mechanism to Tree-sitter when LSP initialization fails. (Verifiable by attempting to load a Go file without `gopls` and confirming AST parsing still succeeds on the dirty buffer).

## Approach / Methodology

1. **JSON-RPC Layer**: Utilize `vscode-jsonrpc` or a lightweight custom implementation to handle message parsing, `Content-Length` headers, and request/response matching.
2. **Configuration Driven**: Maintain a registry of supported languages and their default LSP launch commands (e.g., `['typescript-language-server', '--stdio']`).
3. **MCP Tool Integration**: Update existing MCP tools (e.g., `get_impact_radius`, `semantic_search`) to query the `LspClientManager` first. If the LSP has the dirty state, we use `textDocument/references` or `textDocument/definition`. If not, we fallback to Tree-sitter graph traversals.

## Detailed Implementation Steps

1. **Create `LspClientManager`**: 
   - Define `ILspClient` interface.
   - Implement child process spawning with standard error piping to Docuvia logs.
2. **Implement JSON-RPC Message Protocol**:
   - Handle `initialize`, `initialized`, `textDocument/didOpen`, `textDocument/didChange`, `textDocument/didClose`.
3. **Build the `VirtualFileSystem` (VFS)**:
   - Create a singleton service that maps URIs to string contents.
   - Add methods `open(uri, content)`, `update(uri, content|diff)`, `close(uri)`.
4. **Wire VFS to LSP**:
   - On VFS `open`, send `didOpen`.
   - On VFS `update`, send `didChange`.
5. **Fallback to Tree-sitter**:
   - Intercept LSP startup errors (e.g., `ENOENT`).
   - Flag the language as `ast-only` and route MCP queries to the `ast-core` package instead of the LSP client.

## Affected Workspace Packages

- `artifacts/api-server`: Core implementation of VFS, JSON-RPC, and `LspClientManager`.
- `artifacts/ast-core`: Minor updates to ensure tree-sitter can accept raw string buffers (dirty states) instead of just file paths.
- `lib/core`: Intent router updates to prioritize LSP over AST when the LSP is healthy.
