# VS Code Client Audit: Design ↔ Implementation Alignment

**Date:** 2026-05-25  
**Author:** Requirement Analyzer Agent  
**Scope:** `artifacts/vscode-client/` — all design docs and all source files  
**Phases:** Round 1 (Documentation Updates) → Round 2 (Implementation Gaps)

---

## 1. Complete Inventory of Design Documents

| File | What It Specifies |
|------|-------------------|
| `design/ROUTER.md` | Index of all design docs; navigation guide for agents |
| `design/chat-participant/slash-commands.md` | `@docuvia` chat participant ID, `/explore`, `/query`, `/extract`, `/help` commands (high-level) |
| `design/command-palette/add-decision.md` | `docuvia.addDecision` & `addDecisionFromSelection` full flow: workspace resolution, UUID gen, L2 assignment, YAML frontmatter, file write |
| `design/command-palette/init-project.md` | `docuvia.initProject` flow: workspace resolution, naming, skeleton creation, force-overwrite prompt, post-init reload |
| `design/command-palette/run-extraction.md` | `docuvia.runExtraction` flow: file type filtering, size protection, task dispatching; stops at `TaskRunner.queueExtraction` |
| `design/command-palette/search.md` | `docuvia.openSearch` & `searchFromSelection`; `executeSearch` routing to chat or webview |
| `design/configuration/settings.md` | Six VS Code workspace settings: `search.defaultView`, `extraction.includePatterns`, `extraction.maxLinesWarning`, `extraction.maxFileSizeKBWarning`, `knowledgeGraph.incrementalUpdateThreshold`, `knowledgeGraph.incrementalUpdateRatioThreshold` |
| `design/knowledge-graph/init-action.md` | Inline "Init" button on `project-uninitialized` tree items; `viewsWelcome` fallback |
| `design/knowledge-graph/nodes.md` | Six KGNode types: project, l1tag, l2module, l3entry, unassigned-group, placeholder; icons, contextValues, click behavior |
| `design/knowledge-graph/store.md` | `KnowledgeStore` singleton; multi-root Map; `load()`, `startWatcher()`, `getSnapshotFor()`; **300ms debounce**, **incremental update** vs full reload based on configuration thresholds |
| `design/ui-ux/editor-integration.md` | `DocuviaCodeLensProvider` — declaration-level lenses; `DocuviaHoverProvider` — UUID/symbol hover with **actionable command links** |
| `design/ui-ux/notifications-and-prompts.md` | Toast prefix `"Docuvia: "`, input validation via `validateInput`, unobtrusive prompts, destructive action confirmations |
| `design/ui-ux/webview-panels.md` | `SearchResultsPanel` — **grouped by Project/L1/L2**, keyword highlighting, click-to-navigate; `DashboardPanel` — KG health, extraction queues |

---

## 2. Complete Inventory of Source Files

| File | What It Implements |
|------|--------------------|
| `src/extension.ts` | Entry point; activates all providers, commands, task runner, chat participant, global config load |
| `src/types.ts` | Zod schemas: `L1Tag`, `L2Module`, `L3RouterEntry`, `L3DecisionFrontmatter`, `L3Decision`, `GlobalConfig` |
| `src/KnowledgeStore.ts` | Singleton store; multi-root `Map<string, KnowledgeGraphSnapshot>`; `load()`, `startWatcher()`, `getSnapshotFor()`; **no debounce**, **no incremental update** |
| `src/KnowledgeGraphTreeProvider.ts` | `KGNode` tree (5 types: project, l1tag, l2module, l3entry, placeholder); **missing: unassigned-group** |
| `src/TaskQueueTreeProvider.ts` | Task queue tree (4 status groups: pending, in_progress, done, failed); `getPendingCount()`, `getInProgressCount()` |
| `src/TaskRunner.ts` | LM-based extraction using `vscode.lm` Copilot gpt-4o; 4000-char line chunking; YAML extraction prompt; writes to `l3_decisions/*.md` and updates `l3_router.yaml`; AST chunking is a TODO |
| `src/ChatParticipant.ts` | `@docuvia` participant; 6 built-in L1 ontology templates; project-type scoring; LM tag refinement; `/explore`, `/query`, `/extract`, `/help`; `isBreadthQuery` routing |
| `src/DashboardPanel.ts` | Webview dashboard; `buildDashboardPayload` (tags/modules/decisions/tasks); `openDecision`/`openChat` message handlers; full VS Code theme CSS variables |
| `src/SearchResultsPanel.ts` | Webview search results; **no grouping**, **no keyword highlighting**, **no click-to-navigate** (`enableScripts: false`) |
| `src/DocuviaCodeLensProvider.ts` | CodeLens at function/class declaration lines; module matching via `source_paths`; `docuvia.showDecisionsForLens` command |
| `src/DocuviaHoverProvider.ts` | UUID regex hover; priority: L3 decision → L2 module → L1 tag; **no command links** (`isTrusted = false`) |
| `src/CentralServerClient.ts` | REST client for central server `POST /query`; `CentralServerAuthError` on 401; token via `x-docuvia-token` header |
| `src/CredentialManager.ts` | `vscode.SecretStorage` wrapper (`docuvia.serverToken` key); `getToken`, `setToken`, `clearToken` |
| `src/parser.ts` | `parseTags`, `parseModules`, `parseRouter`, `parseDecision`, `parseGlobalConfig` — all Zod-validated |

---

## 3. Gap Analysis: Implementation Features NOT Documented in Design Docs

These exist in the implementation but have no corresponding design documentation. **Round 1 tasks** will add documentation for each.

### Gap 1 — Global Config (`~/.docuvia/config.yaml`)

- **Where in code:** `extension.ts` L28–45, `parser.ts::parseGlobalConfig`, `types.ts::GlobalConfigSchema`
- **What it does:** Reads `~/.docuvia/config.yaml` at activation; fields: `server_url` (HTTPS URL), `chunking_strategy` (`'line'|'ast'`, default `'line'`), `telemetry.enabled` (bool, default `true`); injected into `KnowledgeStore.globalConfig` and passed to `TaskRunner`
- **Missing from:** No design document. `configuration/settings.md` only covers VS Code workspace settings, not the global config file format.
- **Action (R1):** Add a new section to `configuration/settings.md` — **or** create a new file `configuration/global-config.md` — documenting the file path, schema, and fields.

### Gap 2 — CredentialManager & Server Token Commands

- **Where in code:** `CredentialManager.ts`, `extension.ts` Phase 5 commands, `package.json` command list
- **What it does:** `docuvia.setServerToken` prompts for token (password input) and stores via `vscode.SecretStorage`; `docuvia.clearServerToken` deletes it; token sent as `x-docuvia-token` header
- **Missing from:** No design document covers credential management or these commands.
- **Action (R1):** Add to `configuration/settings.md` a new section describing the credential management model (SecretStorage, token header, error surfacing).

### Gap 3 — L1 Template Ontology & `/explore` Intelligence

- **Where in code:** `ChatParticipant.ts` — `L1_TEMPLATES` array (6 built-in templates: frontend/backend/fullstack/monorepo/library/cli), `detectProjectTypes()` (README + package.json keyword scoring), `refineTagsWithLM()` (Copilot gpt-4o refinement), `buildRawYaml()` (fallback), `handleExplore()` (keyword-type override)
- **Missing from:** `chat-participant/slash-commands.md` only says "/explore: Detect project type and suggest L1 tags" — no mention of templates, scoring algorithm, LM refinement, `acceptL1Tags` button, or the 6 project types.
- **Action (R1):** Expand `chat-participant/slash-commands.md` `/explore` section with the full flow: workspace detection → template scoring → LM refinement → stream output + Accept button.

### Gap 4 — `docuvia.acceptL1Tags` Internal Command

- **Where in code:** `extension.ts`, `package.json` (`enablement: never`), `ChatParticipant.ts` (`stream.button`)
- **What it does:** Writes LM-suggested YAML string to `workspaceFolders[0]/.docuvia/l1_tags.yaml`; only the first workspace is targeted (hardcoded)
- **Missing from:** Not mentioned anywhere in design docs.
- **Action (R1):** Add a note to `chat-participant/slash-commands.md` describing the `acceptL1Tags` internal command and the single-workspace limitation.

### Gap 5 — TaskRunner LM Pipeline Details

- **Where in code:** `TaskRunner.ts` — `vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' })`, 4000-char line chunking, extraction YAML prompt, AST chunking TODO, `writeExtractionResults` (writes `l3_decisions/*.md` + appends `l3_router.yaml`)
- **Missing from:** `command-palette/run-extraction.md` describes the dispatch call but nothing after. The post-extraction pipeline (chunking, LM model selection, YAML parsing, file writes, router update) is entirely undocumented.
- **Action (R1):** Expand `command-palette/run-extraction.md` with a "Post-Dispatch Pipeline" section detailing: LM selection, chunking strategy, prompt format, output parsing, file write path, and router update logic.

### Gap 6 — Hover Provider Scope (YAML/Markdown files)

- **Where in code:** `extension.ts` — `DocuviaHoverProvider` is registered for `{ language: 'yaml', pattern: '**/.docuvia/*.yaml' }` and `{ language: 'markdown', pattern: '**/.docuvia/l3_decisions/*.md' }` in addition to TS/JS/Python
- **Missing from:** `ui-ux/editor-integration.md` mentions hover for "known symbols, tags, or references in the code" but never mentions YAML/Markdown scope or the UUID regex mechanism.
- **Action (R1):** Expand `ui-ux/editor-integration.md` Hover section to document UUID regex trigger, the three-priority lookup (L3 → L2 → L1), and the registered file scopes.

### Gap 7 — `docuvia.showDecisionsForLens` QuickPick Behavior

- **Where in code:** `extension.ts::showDecisionsForLens` — Shows QuickPick with up to 2 decision items; adds "View all in Chat" option when > 2; clicking opens file or opens `@docuvia /query <module>`
- **Missing from:** `ui-ux/editor-integration.md` documents CodeLens but not what happens when the user clicks the lens.
- **Action (R1):** Add a subsection to `ui-ux/editor-integration.md` describing the CodeLens click behavior and QuickPick UX.

### Gap 8 — DashboardPanel Message Protocol & Task Integration

- **Where in code:** `DashboardPanel.ts` — `OpenDecisionMessage`, `OpenChatMessage` message types; path validation before opening file; `TaskQueueTreeProvider` integration in `buildDashboardPayload`
- **Missing from:** `ui-ux/webview-panels.md` mentions "extraction queues" but doesn't document the webview message protocol, the security path validation, or the real-time update trigger (`store.onDidLoad`).
- **Action (R1):** Expand `ui-ux/webview-panels.md` DashboardPanel section with: message protocol types, path security validation rule, real-time update wiring.

### Gap 9 — KnowledgeStore `onDidLoad` Event

- **Where in code:** `KnowledgeStore.ts` — `_onDidLoad` EventEmitter; `onDidLoad` event; subscribed by `KnowledgeGraphTreeProvider` and `DashboardPanel`
- **Missing from:** `knowledge-graph/store.md` lists methods but does not mention the `onDidLoad` event or the reactivity pattern it enables.
- **Action (R1):** Add `onDidLoad` event to the `store.md` Key Methods section.

### Gap 10 — `deactivate()` / KnowledgeStore Disposal

- **Where in code:** `extension.ts::deactivate()` calls `KnowledgeStore.getInstance(outputChannel).dispose()`; `dispose()` clears watchers and resets singleton
- **Missing from:** No design document mentions the deactivation lifecycle.
- **Action (R1):** Add a brief "Lifecycle" section to `knowledge-graph/store.md`.

---

## 4. Conflict Analysis: Implementation Contradicts Design Docs

These are places where the existing code **does not match** what the design docs specify. **Round 1 tasks** will add conflict notes to the relevant design docs; **Round 2 tasks** will fix the code.

### Conflict 1 — KnowledgeStore: No Debounce, No Incremental Update ⚠️ HIGH

- **Design** (`knowledge-graph/store.md`): "Events are debounced (e.g., 300ms)… Incremental Update vs Full Reload based on `incrementalUpdateThreshold` (default 50) and `incrementalUpdateRatioThreshold` (default 0.5)."
- **Implementation** (`KnowledgeStore.ts::startWatcher`): Every single file event (create/change/delete) immediately calls `void this.load()` — no debounce timer, no batch collection, no incremental path.
- **Additional conflict:** `docuvia.knowledgeGraph.incrementalUpdateThreshold` and `docuvia.knowledgeGraph.incrementalUpdateRatioThreshold` are documented in `configuration/settings.md` but are **absent from `package.json` contributes.configuration**.
- **Round 1 action:** Add a conflict note to `knowledge-graph/store.md` and `configuration/settings.md`.
- **Round 2 action:** Implement 300ms debounce + incremental update; add the 2 missing settings to `package.json`.

### Conflict 2 — Missing `docuvia.extraction.maxFileSizeKBWarning` Setting ⚠️ HIGH

- **Design** (`configuration/settings.md`, `command-palette/run-extraction.md`): A `maxFileSizeKBWarning` setting (default 50) should trigger a warning if the file's byte size exceeds the limit.
- **Implementation** (`extension.ts::runExtraction`): Only checks `lineCount > maxLines`; no KB size check exists; setting absent from `package.json`.
- **Round 1 action:** Add a conflict note to `command-palette/run-extraction.md` and `configuration/settings.md`.
- **Round 2 action:** Add the setting to `package.json`; add KB size check in `runExtraction`.

### Conflict 3 — `parseTags` YAML Format Bug 🐛 CRITICAL

- **Design** (`command-palette/init-project.md`): Skeleton `l1_tags.yaml` includes `project_name:` key at the top level **and** a `tags:` array.
- **Implementation** (`parser.ts::parseTags`): `parseYaml(content) as unknown[]` — assumes the YAML document is a top-level list. When the file has the object format `{ project_name: "...", tags: [...] }`, calling `.map()` on the resulting object throws `TypeError: raw.map is not a function`. The `tryParse` wrapper catches this silently and returns `[]`. Result: **any user who manually populates `l1_tags.yaml` using the skeleton's `project_name` + `tags:` format sees zero tags in the tree view.**
- **Round 1 action:** Add a conflict note to `command-palette/init-project.md` and `knowledge-graph/store.md`.
- **Round 2 action:** Fix `parseTags` to handle the object format: if `parseYaml(content)` returns an object with a `tags` property that is an array, use that array. Otherwise treat the result as a flat array.

### Conflict 4 — `initProject` Missing Force-Overwrite Confirmation ⚠️ MEDIUM

- **Design** (`command-palette/init-project.md`): "If the target workspace is already fully initialized… display a warning prompt: '.docuvia already exists. Do you want to overwrite existing files? This action cannot be undone.'"
- **Implementation** (`extension.ts::initProject`): For multi-root, the uninitialized-folder filter means already-initialized folders can never be targeted. For single-root (already initialized), the code re-runs `writeIfAbsent` silently — no warning prompt, no overwrite option. Data is not lost (files skipped), but the user cannot intentionally re-initialize a project.
- **Round 1 action:** Add a conflict note to `command-palette/init-project.md`.
- **Round 2 action:** Add an explicit force-overwrite dialog when targeting an already-initialized folder from the palette.

### Conflict 5 — SearchResultsPanel Missing Grouping, Highlighting, Navigation ⚠️ MEDIUM

- **Design** (`ui-ux/webview-panels.md`): "Results should clearly group by Project, L1 Tags, and L2 Modules. Snippets should highlight the matching keywords. Clicking a result should ideally navigate to the file or open a detailed view."
- **Implementation** (`SearchResultsPanel.ts`): Results are a flat list of cards. No grouping. No highlighting. `enableScripts: false` means no click events can reach VS Code.
- **Round 1 action:** Add a conflict/limitation note to `ui-ux/webview-panels.md`.
- **Round 2 action:** Enable scripts with proper CSP; add grouping; add keyword highlight; add `vscode.postMessage` click handler.

### Conflict 6 — Hover Provider: No Command Links / `isTrusted = false`

- **Design** (`ui-ux/editor-integration.md`): "Provide actionable links (`[Open Decision](command:docuvia.openDecision?args)`) for deeper reading."
- **Implementation** (`DocuviaHoverProvider.ts`): `md.isTrusted = false` on all `MarkdownString` objects, which causes VS Code to strip `command:` links for security. No `command:` links are generated even in the preview text.
- **Round 1 action:** Add a note to `ui-ux/editor-integration.md` about the `isTrusted` requirement.
- **Round 2 action:** Change `isTrusted` to `{ enabledCommands: ['docuvia.openDecision'] }` and register `docuvia.openDecision`.

---

## 5. Missing Implementation Analysis: Design Docs → Not Yet Implemented

These features are specified in design docs but not present in the code. These are the **Round 2 implementation tasks**.

### Missing Impl 1 — Unassigned Decisions Node (Virtual TreeView Group)

- **Design** (`knowledge-graph/nodes.md`): A virtual `unassigned-group` node (contextValue: `unassigned-group`, icon: `$(question)`) under the Project node, containing L3 entries where `l2_module_id === 'unassigned'` or the ID is missing/invalid.
- **Not in:** `KnowledgeGraphTreeProvider.ts` — `getChildren` for `project` nodes only returns L1 tags.
- **Implementation approach:**  
  1. In `getChildren(project)`, after building L1 tag children, filter `snap.decisions` for entries where `l2_module_id === 'unassigned'` or `l2_module_id` is not found in any module's `id`.  
  2. If any unassigned decisions exist, append a `{ kind: 'unassigned-group', id: '__unassigned__', label: 'Unassigned Decisions', workspaceRoot }` node.  
  3. In `getChildren(unassigned-group)`, return the unassigned L3 entry nodes.  
  4. In `getTreeItem`, handle `'unassigned-group'` kind with `$(question)` icon.
- **Affected file:** `KnowledgeGraphTreeProvider.ts`

### Missing Impl 2 — `docuvia.extraction.maxFileSizeKBWarning` Setting + KB Check

- **Design** (`command-palette/run-extraction.md`, `configuration/settings.md`): Read `docuvia.extraction.maxFileSizeKBWarning` (default 50); if file's byte size exceeds it, prompt user with warning (same pattern as line count warning).
- **Not in:** `package.json` `contributes.configuration`; `extension.ts::runExtraction`.
- **Implementation approach:**  
  1. Add setting to `package.json`:  
     ```json
     "docuvia.extraction.maxFileSizeKBWarning": { "type": "number", "default": 50, "description": "..." }
     ```  
  2. In `runExtraction`, after line count check, add:
     ```typescript
     const maxKB = config.get<number>('extraction.maxFileSizeKBWarning', 50);
     const fileSizeKB = Buffer.byteLength(content, 'utf-8') / 1024;
     if (fileSizeKB > maxKB) { /* warning prompt */ }
     ```
- **Affected files:** `package.json`, `extension.ts`

### Missing Impl 3 — Two Missing Configuration Properties in `package.json`

- **Design** (`configuration/settings.md`): `docuvia.knowledgeGraph.incrementalUpdateThreshold` (default 50) and `docuvia.knowledgeGraph.incrementalUpdateRatioThreshold` (default 0.5).
- **Not in:** `package.json` `contributes.configuration`.
- **Note:** These settings are only meaningful after Missing Impl 4 is implemented (debounce/incremental update). They can be added to `package.json` now as a prerequisite.
- **Affected file:** `package.json`

### Missing Impl 4 — KnowledgeStore Debounce + Incremental Update

- **Design** (`knowledge-graph/store.md`): 300ms debounce to batch events; skip non-`.yaml`/`.md` temp files; if changed file count ≤ threshold AND ≤ ratio threshold → incremental (re-parse only changed files); otherwise full reload.
- **Not in:** `KnowledgeStore.ts::startWatcher`.
- **Implementation approach:**  
  1. Replace `const reload = () => { void this.load(); }` with a debounced handler.  
  2. Collect changed file URIs within the debounce window.  
  3. After debounce fires, filter out non-`.yaml`/`.md` files.  
  4. Check thresholds (read from `vscode.workspace.getConfiguration`).  
  5. If within threshold: re-parse only affected workspace snapshot(s) via a new private `_reloadWorkspace(workspaceRoot)` method.  
  6. If exceeds threshold: call full `this.load()`.
- **Affected file:** `KnowledgeStore.ts`

### Missing Impl 5 — `docuvia.openDecision` Command

- **Design** (`ui-ux/editor-integration.md`): References `command:docuvia.openDecision?args` for hover actionable links.
- **Not in:** `extension.ts`, `package.json`.
- **Implementation approach:**  
  1. Register command: `docuvia.openDecision` with argument `(filePath: string)`.  
  2. Implementation: open the file via `vscode.workspace.openTextDocument` + `showTextDocument`.  
  3. Register in `package.json` with `enablement: never` (internal).
- **Affected files:** `extension.ts`, `package.json`

### Missing Impl 6 — Hover `isTrusted` + Command Links

- **Design** (`ui-ux/editor-integration.md`): Actionable `[Open Decision](command:...)` links in hover text.
- **Not in:** `DocuviaHoverProvider.ts` (`isTrusted = false`).
- **Implementation approach:**  
  1. Change `md.isTrusted = false` to `md.isTrusted = { enabledCommands: ['docuvia.openDecision'] }`.  
  2. In the L3 Decision branch, append:
     ```typescript
     md.appendMarkdown(`\n\n[Open Decision](command:docuvia.openDecision?${encodeURIComponent(JSON.stringify([decision.filePath]))})`);
     ```
- **Prerequisite:** Missing Impl 5 must be done first.
- **Affected file:** `DocuviaHoverProvider.ts`

### Missing Impl 7 — Input Validation (`validateInput`) on Key Input Boxes

- **Design** (`ui-ux/notifications-and-prompts.md`): "Validate inputs where possible and use `validateInput` to show inline error messages."
- **Not in:** `addDecision` title input box, `setServerToken` token input box.
- **Implementation approach:**  
  - `addDecision` title: `validateInput: (v) => v.trim().length === 0 ? 'Title cannot be empty' : null`  
  - `setServerToken` token: `validateInput: (v) => v.trim().length === 0 ? 'Token cannot be empty' : null`
- **Affected file:** `extension.ts`

### Missing Impl 8 — Fix `parseTags` for `{ project_name, tags }` YAML Format

- **Design / Bug** (see Conflict 3 above): `parseTags` crashes silently on any `l1_tags.yaml` file that has the `project_name:` top-level key.
- **Implementation approach:**
  ```typescript
  export function parseTags(content: string, filePath: string): L1Tag[] {
    const raw = parseYaml(content) as unknown;
    // Handle object format: { project_name: "...", tags: [...] }
    const list = Array.isArray(raw)
      ? raw
      : (raw as any)?.tags ?? [];
    return (list as unknown[]).map((item, i) => {
      // ... existing Zod validation
    }).filter(...)
  }
  ```
- **Affected file:** `parser.ts`

### Missing Impl 9 — `initProject` Force-Overwrite Prompt

- **Design** (`command-palette/init-project.md`): Show `showWarningMessage` with "Overwrite" / "Cancel" before overwriting an already-initialized project.
- **Not in:** `extension.ts::initProject`.
- **Implementation approach:**  
  In `initProject`, after resolving `targetRoot`, check if `store.snapshots.has(targetRoot)`. If yes, show `showWarningMessage('"${name}" is already initialized. Overwrite existing config files?', 'Overwrite', 'Cancel')`. Proceed only on 'Overwrite'. Then replace `writeIfAbsent` calls with unconditional `writeFile` calls.
- **Affected file:** `extension.ts`

### Missing Impl 10 — CodeLens Multi-Workspace Awareness

- **Design / Bug:** `DocuviaCodeLensProvider` uses `vscode.workspace.workspaceFolders?.[0]` (always first folder) to compute relative paths. In a multi-root workspace, files in workspace 2+ would never match module source paths.
- **Not in:** `DocuviaCodeLensProvider.ts::provideCodeLenses`.
- **Implementation approach:**  
  Replace `const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` with:
  ```typescript
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) return [];
  const snapshot = this._store.getSnapshotFor(document.uri);
  ```
- **Affected file:** `DocuviaCodeLensProvider.ts`

### Missing Impl 11 — SearchResultsPanel Click-to-Navigate + Grouping

- **Design** (`ui-ux/webview-panels.md`): Group by Project / L1 / L2; keyword highlighting; click navigates to file.
- **Not in:** `SearchResultsPanel.ts` (`enableScripts: false`; flat result list).
- **Implementation approach:**  
  1. Enable scripts: `enableScripts: true`; tighten CSP to `script-src 'nonce-xxx'`.  
  2. Group `CentralSearchResult[]` by `projectName` in `buildHtml`.  
  3. Highlight query terms in `snippet` using `<mark>` tags.  
  4. Add `onclick="acquireVsCodeApi().postMessage({ type: 'openResult', title: '...' })"` buttons.  
  5. Handle `openResult` message in `_handleMessage`.  
  **Note:** Central search results (`CentralSearchResult`) do not include file paths — clicking can only open Copilot Chat with the result title as a query. Consider extending `CentralSearchResult` to include an optional `filePath` field in the API spec for future full navigation.
- **Affected files:** `SearchResultsPanel.ts`; potentially `lib/api-spec/openapi.yaml` for `filePath` field

---

## 6. Affected Packages Summary

| Package | Round 1 (Docs) | Round 2 (Code) |
|---------|---------------|----------------|
| `artifacts/vscode-client/design/` | YES — updates to 8 design files | NO |
| `artifacts/vscode-client/src/` | NO | YES — 7 source files |
| `artifacts/vscode-client/package.json` | NO | YES — 3 missing settings |

---

## 7. Proposed Action Plan

### Round 1: Documentation Updates (Docs-Only, No Code Changes)

**Target:** Update design docs to match implementation reality — add missing coverage and annotate conflicts.

| # | File to Update | Action |
|---|----------------|--------|
| R1-1 | `design/configuration/settings.md` | Add "Global Config (`~/.docuvia/config.yaml`)" section; add "Credential Management" section; add conflict notes for the 3 missing package.json settings |
| R1-2 | `design/chat-participant/slash-commands.md` | Expand `/explore` with full L1 template system flow, `detectProjectTypes`, `refineTagsWithLM`, `acceptL1Tags` button; add note about single-workspace limitation of `acceptL1Tags` |
| R1-3 | `design/command-palette/run-extraction.md` | Add "Post-Dispatch Pipeline" section: LM model selection, chunking strategy, YAML extraction prompt format, output parsing, `l3_decisions` write, `l3_router.yaml` update; add conflict note for missing `maxFileSizeKBWarning` |
| R1-4 | `design/knowledge-graph/store.md` | Add `onDidLoad` event; add "Lifecycle / Disposal" section; add conflict note: "debounce and incremental update are NOT yet implemented — current watcher does full reload on every change" |
| R1-5 | `design/knowledge-graph/nodes.md` | Add conflict note: "Unassigned Decisions Node (unassigned-group) is specified but not yet implemented in `KnowledgeGraphTreeProvider.ts`" |
| R1-6 | `design/ui-ux/editor-integration.md` | Expand Hover section: UUID regex mechanism, three-priority lookup, YAML/Markdown scope; add `showDecisionsForLens` QuickPick behavior; add conflict note: "`isTrusted = false` currently prevents command links" |
| R1-7 | `design/ui-ux/webview-panels.md` | Add conflict note for `SearchResultsPanel`: "Currently a flat list with no grouping, no highlighting, and no navigation. `enableScripts` is false." Add DashboardPanel message protocol; add path security rule |
| R1-8 | `design/command-palette/init-project.md` | Add conflict note: "Force-overwrite prompt not yet implemented; `writeIfAbsent` prevents data loss but re-init from palette is not possible"; add `parseTags` YAML format conflict note |

### Round 2: Implementation Gaps (Code Changes, All in `artifacts/vscode-client/`)

Ordered by priority (critical bugs first, then features):

| Priority | Task | File(s) | Effort |
|----------|------|---------|--------|
| P0 | Fix `parseTags` YAML format bug (Impl 8) | `src/parser.ts` | XS |
| P1 | Add 3 missing settings to `package.json` (Impl 3) | `package.json` | XS |
| P1 | Add `maxFileSizeKBWarning` check in `runExtraction` (Impl 2) | `package.json`, `src/extension.ts` | S |
| P1 | `docuvia.openDecision` command (Impl 5) | `src/extension.ts`, `package.json` | XS |
| P2 | Unassigned Decisions node in TreeView (Impl 1) | `src/KnowledgeGraphTreeProvider.ts` | S |
| P2 | Hover `isTrusted` + command links (Impl 6) | `src/DocuviaHoverProvider.ts` | S |
| P2 | `validateInput` on input boxes (Impl 7) | `src/extension.ts` | XS |
| P2 | Fix CodeLens multi-workspace awareness (Impl 10) | `src/DocuviaCodeLensProvider.ts` | XS |
| P2 | `initProject` force-overwrite prompt (Impl 9) | `src/extension.ts` | S |
| P3 | KnowledgeStore debounce + incremental update (Impl 4) | `src/KnowledgeStore.ts` | L |
| P3 | SearchResultsPanel grouping + navigation (Impl 11) | `src/SearchResultsPanel.ts` | M |

---

## 8. Verifiable Success Criteria

### Round 1 Success Criteria
- Every file listed in R1-1 through R1-8 has been updated.
- `design/configuration/settings.md` documents all 6 settings AND the `~/.docuvia/config.yaml` schema.
- `design/chat-participant/slash-commands.md` fully documents the `/explore` L1 template pipeline.
- `design/knowledge-graph/store.md` includes `onDidLoad` event and a conflict note about missing debounce.
- `design/knowledge-graph/nodes.md` includes a conflict note about the missing `unassigned-group` node.
- `design/ui-ux/editor-integration.md` documents UUID hover mechanism and `isTrusted` conflict.
- `design/ui-ux/webview-panels.md` includes SearchResultsPanel limitation note.
- `design/command-palette/init-project.md` includes force-overwrite conflict note + parseTags bug note.
- `design/command-palette/run-extraction.md` includes post-dispatch LM pipeline and `maxFileSizeKBWarning` conflict.

### Round 2 Success Criteria (per item)
- **parseTags fix:** A `l1_tags.yaml` file with `project_name: "..."` and `tags: [{id, slug, name}]` structure correctly renders L1 tags in the tree view.
- **maxFileSizeKBWarning:** When the active file exceeds 50 KB, `docuvia.runExtraction` shows the size warning prompt.
- **Three new settings:** VS Code settings UI (F1 → "Preferences: Open Settings") shows `docuvia.extraction.maxFileSizeKBWarning`, `docuvia.knowledgeGraph.incrementalUpdateThreshold`, `docuvia.knowledgeGraph.incrementalUpdateRatioThreshold`.
- **openDecision command:** Hovering over a UUID in a TypeScript file shows a "Open Decision" link that opens the `.md` file.
- **Unassigned node:** After `addDecision` choosing "unassigned", the Knowledge Graph tree shows an "Unassigned Decisions" group containing that entry.
- **Debounce:** Rapid file changes in `.docuvia/` trigger at most one `load()` call per 300ms window.
- **SearchResultsPanel navigation:** Clicking a result card in the webview opens a chat query for that result.
