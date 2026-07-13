---
---

Date: 2026-07-07
Status: Superseded
Supersedes: None
Supplements: ADR-020, ADR-021, ADR-025
---

# ADR-027: Sub-second Incremental Watch via Hook-Driven Thin Client

## Context

To provide real-time UI and hover feedback in the VS Code client, Docuvia requires sub-second updates to its knowledge graph representation when files are modified. Previously, it was considered to parse files within the extension and update an unbounded in-memory graph. However, maintaining massive ASTs in the client's memory leads to bloat, violates the Single Source of Truth (SSOT), and risks decoupling the UI state from the actual underlying graph state (as established in ADR-004 and ADR-025).

We need an architecture where the IDE remains responsive, memory consumption remains bounded, and the UI accurately reflects the real-time blast radius of dirty, unsaved, or uncommitted changes without modifying the read-only `local.db` or keeping unbound graphs in memory. We also need this to work correctly when a developer has **multiple VS Code windows open on the same workspace** (e.g. two windows on the same repo, or a window plus a headless CLI/MCP session running concurrently) — all of them must converge on the same dirty-state view.

> **Clarification (resolves ambiguity with ADR-001 / ADR-002 / ADR-020)**: A previous version of this decision stated the VS Code client "will not... parse ASTs itself" and implied all diffing was delegated over the network to a separate "API Server" via RPC. That conflicted with ADR-001 (client-side WASM AST anchoring), ADR-002 Standalone Mode (client must self-serve with no server present), and ADR-020 (the VS Code Client is explicitly one of the two environments — alongside the API Server — that embeds and runs the AST Microkernel). This ADR is corrected below. **"Thin Client" in this ADR means the client does not persist an unbounded in-memory graph and does not become a second writer to `local.db` — it does not mean the client is incapable of local computation.**

## Decision

We will adopt a **Hook-Driven UI / Local Payload Offloading** architecture for the VS Code client. The client is a "thin" client only with respect to persisted storage — it never writes to `local.db` from editor state — while still performing its own structural analysis in-process, using the same Core it shares with the CLI.

1. **Embedded Core, Not a Remote Call**: The VS Code Client links the same **Shared Core API** (ADR-021) — including the AST Microkernel (ADR-020) — that the CLI and API Server use. File system watch events and LSP `textDocument/didChange` events are handed directly to the client's own in-process Core instance, which runs AST parsing inside an isolated Worker Thread/Web Worker per ADR-020's Strict Worker Thread Isolation pillar. **No network hop and no RPC to a remote "API Server" is required for this step**, including when the client is fully offline (ADR-002 Standalone Mode, where no such server may even exist).
2. **No Unbounded In-Memory Graph**: The Core instance inside the VS Code Client process does not accumulate a persistent whole-project graph in JS heap memory. For each dirty-buffer or uncommitted-diff event, it computes the delta for the changed range only (leveraging ADR-016 Git Blob-Native Identity for zero-cost identity and ADR-022 Semantic Pruning to keep the blast radius minimal), then immediately hands the result to storage rather than retaining it as long-lived in-memory state.
3. **Payload Offloading to Shared Temp Storage (ADR-025)**: The computed structural delta for unsaved/uncommitted changes (the "Dirty State") is written to `.docuvia/tmp/` using the exact Markdown/JSONL schema defined for the `docuvia-knowledge` orphan branch (ADR-023). This write is performed directly by the client's own embedded Core — it is a local file write, not a call to a remote service. This is identical to how the CLI and API server offload their own dirty-state computations (ADR-025 §2), which is what keeps the logic unified across environments (see Consequences).
4. **Headless LSP Manager Stays Scoped to Headless Environments**: The `@workspace/headless-lsp` library and any RPC to a spawned `tsserver`/`pyright` child process (ADR-025 §2, "Unsaved (Dirty Buffers)") remain reserved for environments that genuinely lack editor/LSP buffer access — i.e. the CLI and standalone MCP server (ADR-025 explicitly notes "the VS Code extension can rely on the host's Language Servers"). The VS Code Client already has direct access to the host's LSP (ADR-015 Tier 3: On-Demand LSP) and its own editor buffers, so it never routes through the Headless LSP Manager for its own dirty-state computation. The Manager exists so headless CLI/MCP processes can reach parity with the IDE, not so the IDE can offload work.
5. **Hook-Driven UI Rendering & Multi-Window Convergence**: Once a Core instance — running inside any process: a specific VS Code window, the CLI, or an MCP session — finishes writing a delta to `.docuvia/tmp/`, it emits a local "dirty state calculated" event inside that process. Independently, **every VS Code window open on the same workspace runs its own lightweight file-system watcher scoped to `.docuvia/tmp/`** (not the whole source tree). Any change to that directory — regardless of which process produced it — is treated as the trigger for that window's own "dirty state calculated" hook. The UI layer in each window subscribes to this hook and re-renders CodeLens/Hover/blast-radius decorations accordingly.
   This guarantees that N open windows on the same workspace converge on an identical view **without requiring a central always-on daemon or a broadcast/pub-sub server**: the shared temp-file directory on disk is the synchronization point for uncommitted state, exactly as the `docuvia-knowledge` branch is the synchronization point for committed state (ADR-023). No new architectural component is introduced by this requirement.
6. **Finality via Git Hooks (ADR-004, ADR-023)**: Real state updates to the Single Source of Truth never happen dynamically from the editor buffer or from the temp-file overlay. The actual state update occurs only when the user issues a `git commit`, which triggers the Git hook to write the final changes to the `docuvia-knowledge` branch and, after that succeeds, materialize `local.db` (ADR-014).
7. **Explicit Server Sync**: Pushing changes to the central, multi-tenant API Server (ADR-003) is unrelated to the dirty-state mechanism above and is not automatic on file save. Pushing must be actively initiated by the user (`git push`) or managed through dedicated sync scripts/CLI commands.

## Consequences

### Positive

- **Flat Memory Footprint**: The VS Code extension's memory remains bounded because it does not store an unbounded AST or in-memory graph representation — dirty deltas are computed, flushed to temp storage, and dropped from JS heap.
- **Strict SSOT Preservation**: `local.db` is never bypassed or corrupted by transient editor states. Finality is exclusively tied to Git commits (ADR-004, ADR-023).
- **Zero Network Dependency for Dirty-State UX**: Because parsing runs in-process via the shared Core/AST Microkernel (ADR-020, ADR-021), hover/CodeLens feedback works identically online, offline, and in ADR-002 Standalone Mode — there is no server to be unreachable from.
- **Unified State Calculation**: The IDE, CLI, and headless CLI/MCP environments all call the identical shared Core logic (ADR-021) for computing blast radius. The only thing that varies by environment is where LSP buffer access comes from — the host's native LSP for VS Code, the Headless LSP Manager for CLI/MCP — not the parsing/diffing logic itself.
- **Multi-Window Consistency**: Because synchronization is anchored to a shared on-disk temp directory rather than per-process memory or a coordinating server, any number of concurrently open VS Code windows — or a window plus a CLI/MCP session — on the same workspace converge on the same dirty-state view.

### Negative

- **File-Watch Overhead**: Each open window maintains a file-system watcher on `.docuvia/tmp/`. On workspaces with high edit frequency across many concurrent windows/processes, this can produce bursts of redundant re-render triggers, requiring debouncing at the UI layer.
- **Temp-File Lifecycle Management**: Because multiple processes (windows, CLI, MCP) may write to the same temp directory, stale or orphaned temp files left by a crashed process must be garbage-collected (ADR-025 Negative consequences) so that other windows don't react to outdated deltas.
- **Asynchronous Complexity**: The UI state must gracefully handle the asynchronous nature of hook-driven updates, requiring clear loading states or eventual consistency in the visual overlay, particularly in the brief window between a file-watcher event firing and the corresponding temp-file write completing.

## Diagram

```mermaid
sequenceDiagram
    participant WinA as VS Code Window A
    participant WinB as VS Code Window B (same workspace)
    participant CoreA as Embedded Core (Window A process)
    participant Worker as AST Worker Thread (ADR-020)
    participant Tmp as .docuvia/tmp/ (Shared, ADR-025)

    WinA->>CoreA: didChange event (dirty buffer)
    CoreA->>Worker: parse changed range
    Worker-->>CoreA: structural delta
    CoreA->>Tmp: write delta (branch-native format, ADR-023 schema)
    Tmp-->>WinA: fs watch event
    Tmp-->>WinB: fs watch event (independent watcher, same path)
    WinA->>WinA: emit "dirty state calculated" hook -> re-render
    WinB->>WinB: emit "dirty state calculated" hook -> re-render
    Note over WinA,WinB: Neither window called the other directly;<br/>the shared temp directory is the sync point.
```

superseded_by: []
