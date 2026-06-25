# Knowledge Graph View: Initialization & Onboarding

> **Related Architecture:**
> - [ADR-001 (VS Code Client Onboarding)](../../adrs/ADR-001-vscode-client-onboarding.md)
> - [ADR-005 (Three-tier knowledge graph / Abstraction)](../../adrs/ADR-005-knowledge-abstraction-strategy.md)

## Feature Description

A context-aware mechanism to bootstrap Docuvia for a workspace. The initialization flow relies on a **dual-state approach**, backed by a [Local-First SQLite](../../adrs/ADR-002-local-first-architecture.md) database instead of legacy YAML configs:

1. **Inline Actions** for multi-root setups where some projects are already initialized.
2. **Welcome Views** for completely uninitialized states to prevent the "Cancel Dead End".

---

## Dual-State UI Integration

### 1. Inline Action (Multi-Root / Partial Init)

- **View Location**: `docuvia.knowledgeGraph` (Tree View)
- **Menu Registration**: `view/item/context`
- **Condition**: `view == docuvia.knowledgeGraph && viewItem == project-uninitialized`
- **Group**: `inline`
- **Command Dispatched**: `docuvia.initProject`

### 2. Welcome Views (Zero Init / Empty Window)

Utilizing the `viewsWelcome` contribution point to handle initial states:

- **Condition 1 (No Workspace)**: `workbenchState == 'empty'`
  - **Content**: "Open a folder to start using Docuvia."
- **Condition 2 (Workspace Open, Not Initialized)**: `docuvia.knowledgeGraph.initializedCount == 0` *(State changes are propagated via [Database-as-IPC](../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md))*
  - **Content**: "Welcome to Docuvia! 🚀\n\nThis workspace is not connected to a Knowledge Graph.\n\n[✨ Initialize Workspace](command:docuvia.initProject)"

---

## Onboarding Workflow

1. User triggers the initialization via the inline `Init` button or the `viewsWelcome` button.
2. If triggered inline, VS Code passes the `KGNode` context. If triggered via `viewsWelcome`, the command queries the user to select a workspace folder (if multi-root) or defaults to the single open folder.
3. **The 3-Way Choice**: The onboarding QuickPick presents three options to the user:
   - `✨ Initialize Knowledge Graph here (New)` - Bootstraps a local [Three-tier knowledge graph](../../adrs/ADR-005-knowledge-abstraction-strategy.md).
   - `🔗 Connect to Remote Graph (Existing)` - Syncs knowledge locally via [Server-Side Zero-to-One](../../adrs/ADR-003-server-side-zero-to-one.md).
   - `📚 Clone & Explore Demo Sandbox (Demo)`

### Git Pre-flight Check & Graph Bootstrapping

When the user selects the **`✨ Initialize Knowledge Graph here (New)`** option, the command strictly requires the target folder to be a Git repository to support the [Git-Isomorphic Graph](../../adrs/ADR-004-git-isomorphic-graph.md).

- **Fail Fast**: If the folder is not a Git repository, it fails fast with an error message (e.g., "Docuvia requires a Git repository. Please initialize Git first.") and aborts.
- **Orphan Branch Provisioning**: Initialization creates or checks out the `docuvia-knowledge` branch for [Orphan Branch / Maintenance](../../adrs/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md), ensuring nodes maintain strict [Git Blob Identity](../../adrs/ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md).
- **AST Microkernel Setup**: Scaffolding boots the [WASM / Microkernel AST](../../adrs/ADR-020-unified-isomorphic-ast-microkernel.md) worker, preparing the workspace for [Progressive Enrichment](../../adrs/ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md) and background metabolism.

---

## Cancel Dead End Handling

If the user hits `ESC` or explicitly cancels the 3-way QuickPick onboarding, the state gracefully aborts to prevent a permanent empty void:

- **Cancel Behavior**: The state remains unchanged.
- **Zero-Init**: The `viewsWelcome` block ("Welcome to Docuvia! 🚀 ...") remains visible because `docuvia.knowledgeGraph.initializedCount` is still `0`.
- **Partial-Init**: The uninitialized workspace node remains in the tree as a stub (`project-uninitialized`), keeping its inline `Init` button.
