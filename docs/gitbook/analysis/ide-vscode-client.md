> **Note:** This document contains competitor analysis and self-evaluation notes that have not been fully integrated into the current implementation yet.

# IDE & VS Code Client Competitor Analysis

## Current State

Docuvia provides a VS Code extension with standard command palette integration and in-editor visual anchors via `HoverProvider` and `CodeLensProvider` that reveal "Blast Radius" data powered by the local SQLite AST graph.

## Competitors

Cursor (Shadow Workspace)

## What Competitors Have That We Don't

- **Shadow Workspace**: Cursor runs a hidden, headless language server in the background to simulate code edits and compile-test them before showing the results to the user.
- **Inline Multi-File Edit Previews**: Cursor provides a rich diff UI spanning multiple files concurrently based on its internal graph.
- **Deep Language Server Protocol (LSP) Hooking**: Cursor intercepts the IDE's native "Go to Definition" and "Find All References".

## What We Have That They Don't

- **Universal Graph Transparency**: Cursor's context engine is a black box. Docuvia explicitly renders the exact `L3 Intent` and AST Call Graph edges via CodeLens, meaning the developer can visually audit exactly what context the AI is going to see _before_ making a prompt.
- **Isomorphic Extension Architecture**: Our VS Code Client directly links to `@workspace/core`, meaning the exact same graph traversal logic running in the CLI runs seamlessly inside the IDE.

## Fatal Flaws

- **Reactive UI**: Our Hover and CodeLens providers are entirely reactive. They only display context if the user explicitly triggers them or scrolls over a symbol.
- **No Predictive Pre-warming**: The client does not proactively analyze unsaved (dirty) buffers to update the graph in real-time, leading to stale CodeLens data while the user is actively typing.

## Immediate Next Steps

- Implement an `onDidChangeTextDocument` event listener that feeds dirty buffer contents directly to the `AstWorkerPool` for real-time, in-memory graph updates.
- Develop a Webview-based "Topology Map" to provide a D3.js visual representation of the L2/L3 Node connections.

```mermaid
flowchart TD
    subgraph Cursor [Competitor: Cursor]
        direction TD
        C_IDE[IDE Editor] -->|Deep Hooking| C_LSP["Hidden Headless LSP<br/>Shadow Workspace"]
        C_LSP -->|Black Box Context| C_DIFF[Inline Multi-File Edit Previews]
    end

    subgraph Docuvia [Docuvia]
        direction TD
        D_IDE["VS Code Web/Desktop"] <--> D_EXT[Isomorphic Extension]
        D_EXT <--> D_CORE["@workspace/core"]
        D_CORE <--> D_SQL[(SQLite AST Graph)]

        D_SQL -->|Explicit Graph Transparency| D_LENS["Hover & CodeLens Providers<br/>Visual L2/L3 Intent"]

        D_IDE -.->|Future: Dirty Buffers| D_WORK["AstWorkerPool<br/>Real-Time Graph Updates"]
    end

    classDef comp fill:#f9d0c4,stroke:#333,stroke-width:2px;
    classDef doc fill:#d4edda,stroke:#333,stroke-width:2px;
    class Cursor comp;
    class Docuvia doc;
```

---

## Action Item Registry

### VS Code Webview Topology

**Severity:** 🟡 MEDIUM · **Target:** `@workspace/vscode-client`

**Deficit:** The current VS Code extension relies on a textual TreeView to display the Knowledge Graph. While functional, it fails to convey the topological relationships (callers/callees) between modules. Text representations fall short of the mental map developers need when assessing blast radius.

**Acceptance Criteria:**

1. Implement a custom Webview Panel in `@workspace/vscode-client`.
2. Reuse the D3.js/Mermaid logic from the `visualize` CLI command ([Local HTML Visualization](cli-core-api.md#local-html-visualization)) to render an interactive map inside VS Code.
3. Wire the Webview to listen for SQLite DB update events so the graph updates in real-time as the developer codes.

### Sub-second Save Updates

**Severity:** 🟡 MEDIUM · **Target:** `@workspace/vscode-client`

**Deficit:** The Git `post-commit` hook successfully captures knowledge at discrete milestones. However, in modern AI-assisted development (Cursor, Copilot), the AI needs context _before_ the commit happens—often while the file is actively being edited. The local graph must be continuously fresh.

**Acceptance Criteria:**

1. Hook into `vscode.workspace.onDidSaveTextDocument` in the extension.
2. When a file is saved, silently trigger the local AST extraction pipeline for that single file.
3. Update the `.docuvia/local.db` instantly. This ensures the AI Agent Hook always retrieves sub-second accurate topological context without waiting for a git commit.

> Cross-reference: the roadmap lists [Sub-second Incremental Watch](../roadmap/features/sub-second-incremental-watch.md) as ✅ Done — verify against `onDidSaveTextDocument` wiring before treating this item as fully closed.
