# User Journeys & Scenarios

This document outlines the primary user journeys for the Docuvia VS Code Extension. It has been re-audited against the current source code (post-ADR-021): decisions are stored as **SQLite rows** (`l1_tags`, `l2_nodes`, `l3_nodes`, `node_links` in `.docuvia/local.db`), not as individual `.docuvia/l3_decisions/*.md` files with frontmatter as earlier drafts of this document described, and there is no `TaskRunner`, `KnowledgeStore`, or `CentralServerClient` class anywhere in `vscode-client` — that logic now lives in `@workspace/core` (`ExtractService`, `QueryService`, `InitService`, `SyncService`, `LocalSnapshotService`).

---

## ⚠️ Known Active Bugs (re-verified against current source)

| ID        | Severity     | Summary                                                                                                                                                                                                                                                                                                                                                                                                                     | Journeys Affected |
| --------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| B-1 / H-1 | **Critical** | Extraction's `INSERT INTO l3_nodes` (via "Save as Decision Record") never sets `l2_node_id` — all extracted decisions are orphaned from any module. See [Run Extraction](../command-palette/run-extraction.md).                                                                                                                                                                                                             | B, H              |
| R-1       | **High**     | `vscode.commands.executeCommand("docuvia.knowledgeGraph.refresh")` is called from several places (extraction save, `/extract`, `acceptL1Tags`) but no command with that exact ID is ever registered — only `docuvia.refreshKnowledgeGraph` is real. These calls silently no-op; the tree still refreshes via its own `.docuvia/local.db` file watcher. See [Tree Nodes](../knowledge-graph/nodes.md#data-management--sync). | A, B, H           |
| D-1       | **Medium**   | CodeLens anchoring uses `vscode.executeDocumentSymbolProvider` results (class/function/interface names), recomputed on every open/save — not AST-diff or hash-based anchoring. Lenses can drift to the wrong line if the module name no longer matches any symbol after an edit. See [Editor Integration](editor-integration.md).                                                                                           | D                 |
| C-1       | **Low**      | `addDecisionCommand`'s `prefillBody` parameter (the wrapped text selection) is accepted but never read — "Add Decision from Selection" behaves identically to "Add Decision" with no selection. See [Add Decision](../command-palette/add-decision.md).                                                                                                                                                                     | C                 |
| N-1       | **High**     | `docuvia.search.defaultView` values other than `"chat"` (including `"webview"`) show a static "temporarily unavailable" message — there is no local-search or RAG fallback implemented for the non-chat path. See [Search](../command-palette/search.md).                                                                                                                                                                   | N                 |

**Resolved since earlier drafts of this document** (previously tracked as A-1/A-2/A-3/M-2 — "`acceptL1Tags` doesn't create `.docuvia/`, doesn't create the DB skeleton, and always writes to `workspaceFolders[0]`"): all three are fixed in the current `commands/tags.ts` + `chat/handlers/explore.ts`. `handleExplore()` resolves the correct workspace root up front (active editor's folder, or an explicit `showWorkspaceFolderPick` prompt in multi-root with no active editor — the code comment literally reads `// BUG A-3 fix`) and passes it through to `acceptL1TagsCommand`, which creates `.docuvia/` + `.docuvia/l3_decisions/` and the full SQLite schema before inserting tags. See [Journey A](#journey-a-the-onboarding-experience-project-discovery) and [Journey M](#journey-m-multi-workspace-knowledge-isolation).

---

## Journey A: The Onboarding Experience (Project Discovery)

**Goal:** Introduce Docuvia to a new or existing codebase via the chat exploration flow.

**Trigger:** User runs `@docuvia /explore` in Copilot Chat (directly, or via the `docuvia.startExplore` welcome-view button).

### Current Happy Path

1. `handleExplore()` resolves the target workspace root (active editor's folder, or a folder picker if multi-root with nothing focused).
2. Project type is detected from `README.md` + `package.json` against the 6 built-in templates ([Slash Commands](../chat-participant/slash-commands.md#explore)), refined by the LM, or generated dynamically if no template matches.
3. A Markdown table of suggested L1 tags is rendered with an **"Accept & Write to local.db"** button, carrying `(yamlContent, workspaceRoot)` as arguments.
4. Clicking it runs `acceptL1TagsCommand`: creates `.docuvia/` and `.docuvia/l3_decisions/` if missing, creates the SQLite schema if missing, and `INSERT OR REPLACE`s the tags into `l1_tags`.
5. Attempts to refresh the tree via `docuvia.knowledgeGraph.refresh` (see bug R-1 above — this call itself no-ops, but the file watcher on `.docuvia/local.db` picks up the change anyway).

### Bad Cases

| Condition                              | Current Behavior                                                                                    | Severity |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | -------- |
| `README.md` is absent                  | `/explore` continues with `package.json`-only detection, or the dynamic AI path if nothing matches. | Low      |
| `package.json` is malformed JSON       | Caught; continues with an empty object, falling through to dynamic AI analysis.                     | Low      |
| LLM API unavailable (no Copilot model) | Falls back to an interactive clarification message asking the user to reply with `/explore <type>`. | Medium   |

---

## Journey B: Deep Knowledge Extraction (Directory, via Chat)

**Goal:** Retro-document an existing folder via `@docuvia /extract src/auth`.

**Current Happy Path:** see [`/extract`](../chat-participant/slash-commands.md#extract) — resolves target, scans directory respecting `.git`/`node_modules`/`.docuvia` and `includePatterns`, then delegates entirely to `ExtractService.extractDecisions()` (`@workspace/core`) for chunking, LLM calls, and persistence. Chunking/prompting internals are not visible from the extension.

**Known limitation (confirmed, B-1):** extracted decisions have no `l2_node_id` set — see the Known Active Bugs table above.

---

## Journey C: Micro-Decision Recording (Selection Capture)

**Goal:** Capture context immediately after writing code, via `Docuvia: Add Decision from Selection`.

**Current Happy Path:** see [Add Decision](../command-palette/add-decision.md) — this command does **not** prompt for a title, UUID, slug, or L2 module, and does not write a new record at all. It runs `ExtractService.extractDecisions()` against the **active file** (ignoring the selection content — bug C-1 above) and shows the results in a modal message. A richer manual-authoring flow (title prompt, L2 assignment, templated Markdown sections) was designed but never implemented — see that doc's Planned section.

---

## Journey D: Contextual Retrieval (Editor Integration)

**Goal:** Surface architectural context inline while editing.

**Current Happy Path:** see [Editor Integration](editor-integration.md) in full. In short: CodeLens matches L2 modules to the open file via `source_paths` globs and shows two lenses per match (`◇ L2: <name> (N decisions)` and a stub "Extrapolate Decisions" lens); Hover shows Blast Radius + incoming/outgoing call-graph edges for the symbol under the cursor via `QueryService`, not L1/L2/L3 decision lookups.

**Known limitation (D-1):** anchor lines are recomputed from document symbols on every save, so lenses can visibly jump if a symbol is renamed or removed.

---

## Journey E: Local Query

**Goal:** Search the local knowledge graph for architectural context.

**Current Happy Path:** `@docuvia /query <text>` or `Docuvia: Open Search` → [`/query`](../chat-participant/slash-commands.md#query) → `QueryService` (`@workspace/core`), reading from the local SQLite DB. There is no `CentralServerClient` or breadth/cross-project query path wired into chat today — cross-project comparison would need to go through the [API server's search endpoint](../../../packages/api-server.md) directly, which the extension does not currently call.

---

## Journey F: Dashboard Overview

**Goal:** Get a high-level view of the project's knowledge health.

**Trigger:** `Docuvia: Open Dashboard` → `DashboardPanel.createOrShow()`.

### Current Happy Path

1. Panel opens and loads a snapshot **once**, at creation time, via `LocalSnapshotService.getSnapshot()` (`dashboard-panel.ts`).
2. Shows tag/module/decision counts, recent decisions, top modules by decision count.
3. Clicking a recent decision runs `docuvia.openDecision`.

### Known Implementation Issues

- **BUG F-2 [Medium, corrected]:** the panel does **not** subscribe to any change event after construction — there is no `KnowledgeStore.onDidLoad` to subscribe to (that class doesn't exist). Counts are frozen until the panel is closed and reopened; there is no in-panel "Refresh" button today.

---

## Journey G: Manual Init & Refresh

**Goal:** Initialize without the chat `/explore` flow, and refresh after external edits.

**Current Happy Path:** see [Init Project](../command-palette/init-project.md) in full — a git-clean check, a single Yes/No consent dialog, then `InitService.init()`. There is no project-name input box, no "already initialized → Overwrite?" prompt (already-initialized folders are filtered out of the picker entirely), and no separate skeleton-creation step distinct from `InitService`.

### Known Implementation Issues

- **BUG G-2 [corrected]:** earlier drafts described a `KnowledgeStore._loading`/`_pendingReload` re-entrancy guard racing against the file-system watcher. That class doesn't exist post-ADR-021; `InitService.init()` runs synchronously to completion inside `@workspace/core` before the command returns, so this specific race no longer applies in its original form. Whether the `.docuvia/local.db` file watcher (see [Tree Nodes](../knowledge-graph/nodes.md#data-management--sync)) can double-fire a refresh alongside the explicit `docuvia.refreshKnowledgeGraph` call after init has not been re-verified.

---

## Journey H: Task Queue / Command-Palette Extraction

**Goal:** Run extraction from the Command Palette and review before saving.

**Current Happy Path:** see [Run Extraction](../command-palette/run-extraction.md) in full — one gate only (include-pattern match; **no** line-count or file-size gate despite those settings existing), a progress notification (not a Task Queue panel entry — there is a `docuvia.taskQueue` tree view registered in `package.json`, but `runExtractionCommand` does not enqueue anything into it), then a modal review with an explicit "Save as Decision Record" button before anything is written to SQLite.

**Known limitation (H-1, confirmed):** same orphaned-decision bug as Journey B.

---

## Journey J: Hover Provider Interaction

**Goal:** Understand a symbol's context by hovering.

**Current Happy Path:** see [Editor Integration → Hover](editor-integration.md#hover-docuviahoverprovider) — Blast Radius + incoming/outgoing edges via `QueryService`, for any recognized symbol in a registered source-file language, not gated by `source_paths` module matching the way CodeLens is.

---

## Journey K: Credential Setup

**Goal:** Configure the Docuvia server token to enable `docuvia sync`.

**Current Happy Path:** see [Settings → Credential Management](../configuration/settings.md#credential-management) — `docuvia.setServerToken` / `clearServerToken` store/clear a token via VS Code `SecretStorage`. The token is consumed by the `docuvia.sync` command (`commands/workspace.ts`), which also reads `server_url` from `~/.docuvia/config.yaml` (not `local.db` — that name referred to the per-workspace SQLite file, a different thing from the global YAML config). If no token is set, `sync` fails immediately with a clear error rather than attempting an unauthenticated request.

---

## Journey L: Command Palette vs Chat Extraction — Key Distinction

| Feature           | Command Palette `runExtraction`                        | Chat `/extract <path>`                                |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Scope             | Active file only                                       | File or directory (recursive)                         |
| Pattern filtering | `includePatterns` via `minimatch`                      | Same, plus `.git`/`node_modules`/`.docuvia` exclusion |
| Size gates        | None implemented today                                 | None implemented today                                |
| Save step         | Explicit "Save as Decision Record" button after review | Delegates persistence entirely to `ExtractService`    |

---

## Journey M: Multi-Workspace Knowledge Isolation

**Goal:** Work with two initialized workspace folders in one VS Code window, each with isolated `.docuvia/` state.

**Current Happy Path:** each command resolves its own workspace root explicitly (from the active editor, an explicit picker, or a passed tree node) rather than assuming `workspaceFolders[0]` — see the "Resolved" note in the Known Active Bugs table above for `acceptL1Tags` specifically. `docuvia.initProject` on a multi-root workspace filters to folders without `.docuvia/` and lets the user pick one; if all are initialized, it shows an info message and exits.

---

## Journey N: Cross-Project Search Panel

**Goal:** View search results in the `SearchResultsPanel` webview instead of chat.

**Current reality:** not wired up. `docuvia.search.defaultView` only recognizes `"chat"` as a functional value — any other value (including `"webview"`, the only alternative offered in the setting's enum) shows a static "temporarily unavailable, use chat" message. `SearchResultsPanel` itself is fully built (see [Webview Panels](webview-panels.md)) but nothing in `commands/search.ts` constructs or shows it. See [Search → Planned](../command-palette/search.md#-planned-not-yet-implemented).
