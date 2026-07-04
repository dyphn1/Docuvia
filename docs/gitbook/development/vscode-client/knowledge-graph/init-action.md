# Knowledge Graph View: Initialization & Onboarding

> **Related Architecture:**
>
> - [ADR-001 (VS Code Client Onboarding)](../../../adr/ADR-001-vscode-client-onboarding.md)
> - [ADR-005 (Three-tier knowledge graph / Abstraction)](../../../adr/ADR-005-knowledge-abstraction-strategy.md)

## Feature Description

A context-aware mechanism to bootstrap Docuvia for a workspace, backed by a [Local-First SQLite](../../../adr/ADR-002-local-first-architecture.md) database instead of legacy YAML configs:

1. **Inline Actions** for multi-root setups where some projects are already initialized.
2. **Welcome Views** for completely uninitialized states to prevent the "Cancel Dead End".

---

## Dual-State UI Integration

### 1. Inline Action (Multi-Root / Partial Init)

- **View Location**: `docuvia.knowledgeGraph` (Tree View)
- **Menu Registration**: `view/item/context`
- **Condition**: `view == docuvia.knowledgeGraph && viewItem == project-uninit` (context value is `project-uninit`, see `artifacts/vscode-client/src/knowledge-graph-tree-provider.ts`)
- **Group**: `inline`
- **Command Dispatched**: `docuvia.initProject`

### 2. Welcome Views (Zero Init / Empty Window)

Utilizing the `viewsWelcome` contribution point to handle initial states:

- **Condition 1 (No Workspace)**: `workbenchState == 'empty'`
  - **Content**: "Open a folder to start using Docuvia."
- **Condition 2 (Workspace Open, Not Initialized)**: `docuvia.knowledgeGraph.initializedCount == 0`
  - **Content**: "Welcome to Docuvia! 🚀\n\nThis workspace is not connected to a Knowledge Graph.\n\n[✨ Initialize Workspace](command:docuvia.initProject)"

---

## Onboarding Workflow — Current Reality

Both entry points above dispatch the same `docuvia.initProject` command described in detail in [Init Project](../command-palette/init-project.md). In short:

1. User triggers initialization via the inline `Init` button or the `viewsWelcome` button (both call `docuvia.initProject`; the inline variant passes the tree node's `workspaceRoot`).
2. A `git status --porcelain` pre-flight check blocks on any uncommitted changes.
3. A single Yes/No consent dialog — no 3-way choice — asks to proceed.
4. On "Yes", `InitService.init()` (`@workspace/core`) runs directly: it does not separately validate that the folder is a git repository first — if it isn't, the `git status` call itself fails and surfaces as a generic "Git error: ..." message.

### Cancel handling

If the user dismisses the consent dialog (anything other than "Yes"), the command returns silently and state is unchanged:

- **Zero-Init**: the `viewsWelcome` block remains visible, since `docuvia.knowledgeGraph.initializedCount` is still `0`.
- **Partial-Init**: the uninitialized workspace node remains in the tree as a stub (`project-uninit`), keeping its inline `Init` button.

---

## 🚧 Planned (Not Yet Implemented)

The original design specified a richer onboarding QuickPick, not present in the current `initProjectCommand`:

- **The 3-Way Choice**: `✨ Initialize Knowledge Graph here (New)` / `🔗 Connect to Remote Graph (Existing)` (via [Server-Side Zero-to-One](../../../adr/ADR-003-server-side-zero-to-one.md)) / `📚 Clone & Explore Demo Sandbox (Demo)`.
- **Explicit git-repo fail-fast**: a dedicated check ("Docuvia requires a Git repository. Please initialize Git first.") before attempting any git operations, rather than surfacing the raw `git status` error.

See [Init Project → Planned](../command-palette/init-project.md#-planned-not-yet-implemented) for the full list of unimplemented onboarding design intent shared with this view.
