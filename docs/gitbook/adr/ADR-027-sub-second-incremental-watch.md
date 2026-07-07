# ADR-027: Sub-second Incremental Watch via Hook-Driven Thin Client

## Status

Accepted

## Context

To provide real-time UI and hover feedback in the VS Code client, Docuvia requires sub-second updates to its knowledge graph representation when files are modified. Previously, it was considered to parse files within the extension and update an unbounded in-memory graph. However, maintaining massive ASTs in the client's memory leads to bloat, violates the Single Source of Truth (SSOT), and risks decoupling the UI state from the actual underlying graph state (as established in ADR-004 and ADR-025).

We need an architecture where the IDE remains responsive, memory consumption remains bounded, and the UI accurately reflects the real-time blast radius of dirty, unsaved, or uncommitted changes without modifying the read-only `local.db` or keeping unbound graphs in memory.

## Decision

We will adopt a **Hook-Driven UI / Payload Offloading** architecture for the VS Code client, ensuring it acts as a pure listener (Thin Client).

1. **Thin Client & Event Forwarding**: The VS Code client will not maintain an in-memory graph or parse ASTs itself. Instead, it listens to file system watch events or LSP `didChange` events and forwards the dirty payloads.
2. **Payload Offloading to Temp Storage (ADR-025)**: For sub-second feedback of unsaved or uncommitted changes (the "Dirty State"), the client offloads these payloads to `.docuvia/tmp/` files via a local API/RPC call to the API Server or Headless LSP Manager. The server computes the lightweight structural diffs.
3. **Hook-Driven UI rendering**: Once the backend computes the dirty state, it emits a "dirty state calculated" hook/event. The VS Code UI listens to these hooks synchronously to render the blast radius over the UI.
4. **Finality via Git Hooks (ADR-004)**: Real state updates to the Single Source of Truth never happen dynamically from the editor buffer. The actual state update occurs only when the user issues a `git commit`, which triggers the Git hook to write the final changes to the `docuvia-knowledge` branch.
5. **Explicit Server Sync**: Pushing changes to the central server is not automatic on file save. Pushing must be actively initiated by the user or managed through dedicated sync scripts.

## Consequences

### Positive

- **Flat Memory Footprint**: The VS Code extension's memory remains bounded because it does not store unbounded ASTs or in-memory graph representations.
- **Strict SSOT Preservation**: `local.db` is never bypassed or corrupted by transient editor states. Finality is exclusively tied to Git commits.
- **Unified State Calculation**: By offloading parsing to the API Server/Headless LSP Manager, both the IDE and headless CLI/MCP environments use the identical logic for calculating blast radius.
- **Responsive UI**: The UI reacts to asynchronous hook events ("dirty state calculated"), providing sub-second feedback without blocking the main editor thread.

### Negative

- **RPC Overhead**: Requires fast, reliable local API/RPC communication between the VS Code extension and the background API Server to offload payloads and stream events back.
- **Asynchronous Complexity**: The UI state must gracefully handle the asynchronous nature of hook-driven updates, requiring clear loading states or eventual consistency in the visual overlay.
