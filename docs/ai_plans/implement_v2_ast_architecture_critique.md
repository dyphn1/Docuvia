# V2 AST Architecture Critique (QA/PM Challenger Review)

**Author:** Requirement Analyzer (Adversarial QA/PM Persona)
**Target:** Leo's V2 AST Architecture Proposal

## 1. Implementation Goals
To validate and harden the V2 AST architecture proposal against real-world product constraints, deployment friction, and edge-case environments. SRE demands for raw performance must be balanced against maintainability, VS Code extension limitations, and graceful degradation.

*   **Goal 1:** Ensure the parser distribution strategy does not bloat the extension VSIX or fail in air-gapped corporate environments.
*   **Goal 2:** Guarantee that Docuvia continues to function (graceful degradation) in non-Git workspaces.
*   **Goal 3:** Prevent host (VS Code) memory exhaustion from worker pool and write queue explosions.

## 2. Approach / Methodology (Adversarial Critique)

### Attack 1: Native `tree-sitter` vs. WASM (`web-tree-sitter`)
*   **SRE Proposal:** Use native `tree-sitter` for maximum AST parsing throughput.
*   **QA/PM Attack:** Packaging native C/C++ `.node` binaries for a VS Code extension is a distribution nightmare. We have to cross-compile for Windows x64/arm64, macOS Intel/Apple Silicon, and Linux glibc/musl. If we bundle 10+ language grammars, the VSIX size will explode. If we download dynamically, air-gapped enterprise users will fail.
*   **Forced Resolution:** Leo must pivot to `web-tree-sitter` (WASM). WASM is universally portable, supports web-extension contexts (github.dev), and eliminates node-gyp build failures on `npm install`. The ~30% CPU penalty is acceptable to guarantee 100% installation success.

### Attack 2: Worker Pools & Streams
*   **SRE Proposal:** Spawn worker pools and stream AST JSON across boundaries.
*   **QA/PM Attack:** VS Code extensions run inside the Extension Host, which has strict memory constraints. Spawning 8 worker threads on a user's laptop will freeze their IDE. Furthermore, serializing/deserializing massive ASTs via structured clone across the V8 isolate boundary destroys the concurrency speedup.
*   **Forced Resolution:** Limit the worker pool dynamically based on `os.cpus() - 1` with a hard cap (e.g., 2-4 for extension host). Do not stream raw AST JSON; extract symbols/relationships *inside* the worker and only send the distilled Docuvia metadata back to the main thread.

### Attack 3: Git-native diffing (`git diff-tree -M`)
*   **SRE Proposal:** Rely on Git for lightning-fast delta detection.
*   **QA/PM Attack:** What if the user opens a `.zip` download, an FTP drive, or a freshly initialized project without an initial commit? The blueprint mandates *graceful degradation*. If `git diff-tree` crashes, the entire Graph Engine halts.
*   **Forced Resolution:** Implement a dual-path ingest pipeline. Path A uses Git-native diffing. Path B (Fallback) triggers an `xxhash`-based directory traversal if `.git` is absent or the command fails, calculating diffs by caching local hashes.

### Attack 4: Single-Threaded Write Queue
*   **SRE Proposal:** A single queue feeding Drizzle/SQLite to avoid database locking.
*   **QA/PM Attack:** During an initial workspace ingest (e.g., 10,000 files), the worker pools will flood the write queue. The in-memory array will explode, causing an Out-Of-Memory (OOM) crash in the Extension Host.
*   **Forced Resolution:** The queue must implement **Backpressure**. If the write queue exceeds `MAX_QUEUE_SIZE` (e.g., 500 items), the worker pool must be explicitly paused/throttled until the database catches up.

## 3. Detailed Implementation Steps (Action Items)

1.  **Refactor Parser Core:** Replace native `tree-sitter` bindings with `web-tree-sitter` (WASM) in the dependency tree. Bundle core `.wasm` language files directly in the extension payload.
2.  **Backpressure Implementation:** Add a queue length monitor to the SQLite write stream. Emit a `pause` event to workers when `queue > 500`, and `resume` when `queue < 100`.
3.  **Fallback Strategy:** Add a `fs.stat` check for `.git`. If missing, route ingestion to a fast file-system crawler (using `fast-glob` + `xxhash`) to compute deltas manually.
4.  **Worker Payload Reduction:** Modify worker scripts to map AST nodes to Docuvia Knowledge Graph models (L2/L3) *before* `postMessage`, transferring only the graph vertices/edges.

## 4. Implementation Details
*   **Affected Packages:**
    *   `artifacts/api-server/src/lib/ingest/` (Git vs FS fallback logic).
    *   `artifacts/vscode-client/` (WASM migration, worker pool limits, bundling).
    *   `lib/db/` (Write queue backpressure mechanism).
