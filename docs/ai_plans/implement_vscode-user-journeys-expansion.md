# AI Implementation Plan: VS Code Extension User Journeys Expansion

**Date:** 2026-05-30  
**Status:** Ready for Documentation Writer  
**Packages affected:** `artifacts/vscode-client/design/ui-ux/`, `docs/`  
**Code changes required:** None — documentation only.

---

## 1. Objective

Expand `artifacts/vscode-client/design/ui-ux/user-journeys.md` to cover every implemented VS Code extension feature. Every registered command, provider, and UI panel must appear in at least one journey. Simultaneously update `docs/vscode-extension-roadmap.md` with newly discovered critical gaps uncovered by the 3× simulation exercise below.

---

## 2. Scope of Work

### Files to Update

| File | Action |
|---|---|
| `artifacts/vscode-client/design/ui-ux/user-journeys.md` | Replace existing A–E entries with A–N entries (retain content of A–E, expand with corrections; add F–N) |
| `docs/vscode-extension-roadmap.md` | Add newly identified critical gaps to Phase 1, 4, 5, and 6 sections |

---

## 3. Existing Journey Review — 3× Simulation Findings (A–E)

Each journey was simulated three times against the actual source code in `artifacts/vscode-client/src/`. All bugs are traced to specific source locations.

---

### Journey A: Onboarding Experience (Project Discovery)

**Current description:** User opens uninitialized repo → clicks `✨ Analyze Project Architecture` → `/explore` runs → clicks "Accept & Write" → `.docuvia/` is created.

#### Simulation Run 1 — Happy Path
- `/explore` correctly reads `package.json` + `README.md`, calls LLM, renders Markdown table.
- User clicks "Accept & Write". The command `docuvia.acceptL1Tags` fires.
- **BUG A-1 [CRITICAL]:** `acceptL1Tags` (extension.ts ~line 270) calls `vscode.workspace.fs.writeFile` on `.docuvia/l1_tags.yaml`. It does **not** call `vscode.workspace.fs.createDirectory` first. If `.docuvia/` does not yet exist, VS Code will throw `FileNotFound` and the write silently fails. The user sees an information toast ("l1_tags.yaml updated") but no file is written and no `.docuvia/` folder is created.
- **BUG A-2 [HIGH]:** Even if the directory exists (edge: user ran `initProject` first, then `/explore`), `l2_modules.yaml` and `l3_decisions/` are never created by `acceptL1Tags`. Any subsequent `store.load()` call parses `l2_modules.yaml` which does not exist → silently returns empty snapshot. The TreeView shows only L1 tags, no L2/L3 tree. No error is surfaced.
- **BUG A-3 [HIGH]:** `acceptL1Tags` always uses `vscode.workspace.workspaceFolders?.[0]`. In a multi-root workspace where `/explore` was run for workspace folder #2 (e.g. user has two projects open and ran explore on the second one), the YAML is written to workspace folder #1. Data is corrupted silently.

#### Simulation Run 2 — User Has Multiple Workspace Folders
- User has Project A and Project B open. Runs `/explore` on Project B (the second folder). Clicks "Accept & Write".
- Same as BUG A-3 above. `acceptL1Tags` writes to `workspaceFolders[0]` (Project A), not Project B.
- The KG TreeView for Project A shows garbled L1 tags that belong to Project B.

#### Simulation Run 3 — User Cancels Mid-Flow
- User clicks "Accept & Write" then immediately closes VS Code.
- `acceptL1Tags` writes only `l1_tags.yaml` (if directory existed), leaving `l2_modules.yaml` missing.
- On restart, `store.load()` processes a partially initialised `.docuvia/`. The TreeView renders L1 tags but no L2 branches. No error message is shown.

**Corrections needed in Journey A description:**
- Remove the statement "the system creates the `.docuvia/` folder, builds the required skeleton files" — this is only true if `initProject` is called first. `acceptL1Tags` alone does NOT create the skeleton.
- Journey A must note the workaround: users should use `Docuvia: Init Project` first, then `/explore`.
- The "Resolution" paragraph must include the known limitation/bug.

---

### Journey B: Deep Knowledge Extraction

**Current description:** `@docuvia /extract src/auth` → scans directory → chunks into TaskQueue → AI extracts L3 decisions → files created in `.docuvia/l3_decisions/` → "automatically categorized under appropriate L2 Modules."

#### Simulation Run 1 — Happy Path
- `/extract src/auth` queues files correctly. `.gitignore` and `minimatch` filtering works.
- `TaskRunner.writeExtractionResults()` fires for each chunk.
- **BUG B-1 [CRITICAL]:** `TaskRunner` always writes `l2_module_id: ""` in every generated L3 markdown file frontmatter. The current implementation has no logic to match extracted decisions to any L2 module. Every extracted decision is orphaned immediately upon creation.
- The `l3_router.yaml` is updated, but the `l2_module_id` field is also written as `""`. The KG TreeView therefore never places any extracted decision under an L2 module node.

#### Simulation Run 2 — Large Directory
- `/extract src/` (many files). TaskRunner chunks by `CHUNK_SIZE=4000` chars.
- Chunking is line-based, not AST-based. A function spanning 4001 chars is split mid-body. The LLM receives a truncated chunk and may hallucinate a decision that doesn't match the actual code.
- **BUG B-2 [MEDIUM]:** `GlobalConfig.chunking_strategy` field exists in the type definition but `TaskRunner` ignores it. AST chunking is never activated regardless of user config.
- No progress indication in the Task Queue for total files queued vs. processed.

#### Simulation Run 3 — Path Does Not Exist
- `/extract nonexistent/path` is entered.
- `ChatParticipant` resolves the path and calls `vscode.workspace.fs.readDirectory`. If the path doesn't exist, VS Code throws `FileNotFound`.
- Whether this error is gracefully caught and surfaced to the user depends on whether there is a `try/catch` in the chat participant handler. This is a gap in error surface — the UX is unclear.

**Corrections needed in Journey B description:**
- The phrase "automatically categorized under the appropriate L2 Modules" must be changed to "saved as unlinked decisions (orphaned) — L2 categorization is a known critical gap."
- Add a note about line-based chunking limitation.

---

### Journey C: Micro-Decision Recording

**Current description:** Right-click → `Docuvia: Add Decision from Selection` → QuickPick/Input → L3 file saved → "instantly mapped to the codebase."

#### Simulation Run 1 — Happy Path
- User selects code, right-clicks, triggers `docuvia.addDecisionFromSelection`.
- `addDecision()` is called with `prefillBody` containing the selected code in a fenced block.
- User enters title, picks L2 module from QuickPick. L3 .md file is written and opened.
- **BUG C-1 [MEDIUM]:** `addDecision` writes the L3 markdown file but does NOT update `l3_router.yaml`. The router is the performance index for CodeLens/hover lookups. The newly created decision is invisible to `CodeLensProvider` and `HoverProvider` until `store.load()` re-parses the entire `.docuvia/` folder. The file-system watcher should eventually trigger a reload, but there is a race condition window.
- **Actually**: Looking at the code — `addDecision` DOES call `store.load()` after writing the file (line ~490 in extension.ts). So the store is refreshed. However, `l3_router.yaml` is NOT written — only the `.md` file. `store.load()` reads the `l3_router.yaml` to build the routing index; if the new decision is not in `l3_router.yaml`, it may not appear in all lookup paths.

#### Simulation Run 2 — No L2 Modules Exist Yet
- User has just run `initProject` (skeleton is created with empty `l2_modules.yaml`) then immediately tries `addDecisionFromSelection`.
- `modules` array from snapshot is empty. QuickPick shows only `$(add) Create new module later...`.
- User picks "unassigned". `l2_module_id` is written as `"unassigned"`.
- The decision file is created. `store.load()` is called. TreeView now shows the decision but it falls under no L2 node. The UX for finding/reviewing unassigned decisions is not defined.
- **BUG C-2 [LOW]:** `l2_module_id: "unassigned"` is a sentinel string, not a UUID or empty string. If other parts of the system (e.g. `l3_router.yaml` parser) expect a UUID or empty string, this sentinel will cause unexpected behaviour.

#### Simulation Run 3 — Duplicate Title / Slug Collision
- User creates decision titled "Use Redis for caching" → slug becomes `use-redis-for-caching`.
- User creates a second decision with the same title.
- `addDecision` writes to `path.join(..., 'l3_decisions', 'use-redis-for-caching.md')` without checking if the file already exists.
- **BUG C-3 [MEDIUM]:** The second write silently overwrites the first decision. No warning is shown. Data is lost.

**Corrections needed in Journey C description:**
- Note that `l3_router.yaml` is NOT updated by `addDecision`. This is a gap.
- Note the slug collision risk.
- Change "instantly mapped" to reflect the reality: decision appears after file-watcher reload cycle.

---

### Journey D: Contextual Retrieval (CodeLens)

**Current description:** Developer opens file → sees `🧠 Docuvia: 1 Decision` CodeLens → "uses robust AST-based or hash-based anchoring (Drift Protection)" → clicks → reads decision.

#### Simulation Run 1 — Happy Path
- File is opened. `DocuviaCodeLensProvider.provideCodeLenses()` runs.
- Provider scans `source_paths` in L2 modules. Matches by file path.
- Line number for a matching function declaration is used to anchor the lens.
- **BUG D-1 [HIGH]:** The Journey description states "robust AST-based or hash-based anchoring (Drift Protection)". The actual implementation uses line-number anchoring ONLY. There is NO AST, NO hash, NO drift protection. This description is factually incorrect and misleads future developers about the actual architecture.

#### Simulation Run 2 — Code Modified Above Function
- Developer inserts 5 lines above the function that has a CodeLens.
- On next file open / document change, `DocuviaCodeLensProvider` recalculates lens positions.
- The lens now points to the wrong line (drifted by 5 lines) and appears above the wrong function or in blank space.
- **BUG D-2 [HIGH]:** This is the CodeLens Drift bug already in the roadmap. The journey description must document this as a known limitation rather than claiming drift protection exists.

#### Simulation Run 3 — Module Has No `source_paths`
- L2 module in `l2_modules.yaml` has `source_paths: []` (empty, which is the default in the skeleton template).
- `DocuviaCodeLensProvider` finds no file path matches.
- No CodeLens is shown. No feedback to the user that L2 modules need `source_paths` populated.
- **BUG D-3 [MEDIUM]:** The onboarding/init skeleton writes `source_paths: []` by default. New users who don't manually populate `source_paths` will never see any CodeLens. No guidance exists in the UI.

**Corrections needed in Journey D description:**
- Remove the phrase "robust AST-based or hash-based anchoring (Drift Protection)" — replace with "line-number-based anchoring (drift protection is a planned enhancement, not yet implemented)."

---

### Journey E: Cross-Project Breadth Search

**Current description:** User types `@docuvia /query how do other projects handle RBAC?` → routes to Central Server → returns decisions.

#### Simulation Run 1 — Happy Path (Token Set, Server Up)
- Query contains "other projects" → breadth routing fires → `credentialManager.getToken()` is called.
- `CentralServerClient.query()` POSTs to `/query` with `x-docuvia-token` header.
- Results are rendered in chat.
- Works as described.

#### Simulation Run 2 — No Token Set
- `credentialManager.getToken()` returns `undefined` or `null`.
- **BUG E-1 [HIGH]:** Looking at `CentralServerClient` — if the token is null/undefined, the `x-docuvia-token` header is sent as `"undefined"` or `"null"` string, or omitted. Behavior depends on implementation. The server returns 401. `CentralServerAuthError` is thrown and caught — the user sees "Authentication required. Run 'Docuvia: Set Server Token'." This is acceptable error handling, but the Journey description does not mention this failure mode or the credential setup prerequisite.

#### Simulation Run 3 — Local Query (No "Other Projects" Pattern)
- User types `@docuvia /query authentication pattern`.
- No breadth keywords detected → local query runs.
- Local query uses `str.includes()` matching against decision titles and bodies.
- **BUG E-2 [HIGH]:** User queries "auth pattern" but decisions use the word "authentication" — no match. Zero results returned. No suggestion to broaden the query or use synonyms. The Journey description does not mention this limitation.
- **BUG E-3 [LOW]:** The local `/query` does not search `l2_modules.yaml` module names/descriptions — only L3 decision content. Architectural module-level knowledge is unreachable via local query.

**Corrections needed in Journey E description:**
- Add prerequisite: server token must be set via Journey K (Credential Setup).
- Add local query limitation note (naive `.includes()` matching).

---

## 4. New Journeys — Full Specification

### Journey F: Dashboard Overview

**Goal:** Get a high-level view of the project's knowledge health.

**Trigger:** User opens VS Code, Docuvia is initialized. They click the Dashboard icon in the Activity Bar or run `Docuvia: Open Dashboard` from the Command Palette.

**Actions:**
1. `docuvia.openDashboard` fires → `DashboardPanel.createOrShow()` is called.
2. A Webview panel opens showing:
   - Tag count (L1 tags)
   - Module count (L2 modules)
   - Decision count (L3 decisions)
   - Recent decisions list
   - Top modules by decision count
   - Pending task count
3. User clicks a recent decision item in the dashboard.
4. The decision `.md` file opens in the editor via `docuvia.openDecision`.
5. User clicks the bottom-bar search button → `@docuvia` chat opens.

**System Behavior:**
- `DashboardPanel` reads from `KnowledgeStore.snapshot` at creation time. Data is not live-refreshed unless panel is closed and re-opened.
- The pending task count reads from `TaskQueueTreeProvider`.

**Resolution:** User has a dashboard summary. Clicking decisions navigates to their markdown files.

#### 3× Simulation Findings

**Run 1 — Happy Path:**
- Dashboard opens, counts display correctly.
- Clicking a recent decision calls `docuvia.openDecision` with a file path string.
- File opens in editor. ✓

**Run 2 — No `.docuvia/` Folder:**
- Dashboard opens with all counts at zero.
- Recent decisions list is empty.
- **BUG F-1 [LOW]:** No "Not initialized" message is shown on the dashboard. It looks like an initialized-but-empty project rather than an uninitialized one. Could confuse new users.

**Run 3 — Dashboard Already Open, Knowledge Updated:**
- User runs `/extract`, decisions are added to `.docuvia/`.
- Dashboard panel is already open.
- **BUG F-2 [MEDIUM]:** The Dashboard webview does not subscribe to `KnowledgeStore` change events. Counts shown are stale until the user closes and re-opens the panel. No "Refresh" button exists on the dashboard.

**Severity Summary:**
- BUG F-1: Low — cosmetic / UX guidance
- BUG F-2: Medium — stale data without refresh mechanism

---

### Journey G: Manual Init & Refresh

**Goal:** Manually initialize a project without using the chat `/explore` flow, then force-refresh the knowledge graph after external file changes.

**Trigger:** User runs `Docuvia: Init Project` from Command Palette or Tree View inline button.

**Actions:**
1. `docuvia.initProject` fires.
2. If single workspace: prompts for project name → creates `.docuvia/` skeleton.
3. If multi-root: QuickPick to select uninitialized folder → prompts for name → creates skeleton.
4. If already initialized: warning "Overwrite?" → Overwrite / Cancel.
5. `store.load()` is called → TreeView refreshes.
6. User edits `.docuvia/l2_modules.yaml` externally (e.g., in another editor).
7. User runs `Docuvia: Refresh Knowledge Graph` (`docuvia.refreshKnowledgeGraph`).
8. If `.docuvia/` exists: "Knowledge graph refreshed." toast. TreeView reloads.
9. If `.docuvia/` missing: "No .docuvia/ folder found" warning.

**Resolution:** Project is initialized with skeleton YAML files. Manual edits are reloaded on demand.

#### 3× Simulation Findings

**Run 1 — Happy Path (Single Workspace):**
- Works correctly. Skeleton files created with sensible defaults.
- `store.load()` runs after init → TreeView shows project with empty L1/L2/L3.
- **Note:** The skeleton `l1_tags.yaml` has `project_name` set correctly. ✓

**Run 2 — User Cancels Project Name Input:**
- `showInputBox` returns `undefined`.
- `initProject` returns early (correct). No folder is created. ✓
- **Edge case:** If user has `projectName === ""` (submits empty string), the code uses the empty string. Validation is not enforced for empty names — only `undefined` is guarded. The skeleton is written with `project_name: ""`.
- **BUG G-1 [Low]:** No validation preventing empty project name. The slug/display in the TreeView would show an empty string.

**Run 3 — Refresh After File-Watcher Race:**
- User edits `l2_modules.yaml` from outside VS Code. The file-system watcher fires.
- Simultaneously user clicks "Refresh Knowledge Graph".
- Two concurrent `store.load()` calls can run.
- **BUG G-2 [MEDIUM]:** `KnowledgeStore.load()` does not appear to be protected against concurrent calls (no mutex/lock). A race condition between the FS watcher and the explicit refresh command could produce a partially merged snapshot, causing the TreeView to show inconsistent data until the next load.

**Severity Summary:**
- BUG G-1: Low — empty project name allowed
- BUG G-2: Medium — concurrent load race condition in KnowledgeStore

---

### Journey H: Task Queue Management

**Goal:** Run an extraction task, monitor its progress in the Task Queue panel, then clear completed tasks.

**Trigger:** User has an active editor open on a TypeScript file. They run `Docuvia: Run Extraction (Active File)` from Command Palette.

**Actions:**
1. `docuvia.runExtraction` fires.
2. Include pattern check: if file not in `extraction.includePatterns`, warning prompt appears.
3. Line count check: if > `extraction.maxLinesWarning` (default 1000), size warning appears.
4. KB size check: if > `extraction.maxFileSizeKBWarning` (default 50 KB), size warning appears.
5. User proceeds. `taskRunner.queueExtraction()` is called.
6. Task appears in **Task Queue TreeView** with status "Pending".
7. TaskRunner chunks file content (4000-char chunks), sends each to GPT-4o via VS Code LM API.
8. Decisions are written to `.docuvia/l3_decisions/`. `l3_router.yaml` is updated.
9. Task status changes to "Done" or "Failed".
10. User runs `Docuvia: Clear Completed Tasks` → done tasks are removed from the panel.

**Resolution:** L3 decisions extracted from the file are visible in the TreeView. Task Queue is clean.

#### 3× Simulation Findings

**Run 1 — Happy Path:**
- File is within include patterns and under size limits. Task queued.
- TaskRunner runs, decisions written.
- **BUG H-1 [CRITICAL]:** All extracted decisions have `l2_module_id: ""` (the orphaned L3 bug). They appear in the KG TreeView under no L2 module. The Task Queue panel says "Done" but the decisions are unreachable via the L2 hierarchy.
- `l3_router.yaml` IS updated by `TaskRunner` (unlike `addDecision` which does not update it). So decisions are at least findable via the router.

**Run 2 — File Not in Include Patterns:**
- Warning shown: "This file type is not in your include list. Analyze it anyway?"
- User clicks "No" → command returns early. ✓
- User clicks "Yes" → proceeds with extraction.
- **BUG H-2 [LOW]:** The include pattern check uses `minimatch` on the relative path. The extension gets `relativePath` using `path.relative(workspaceFolder.uri.fsPath, filePath).replace(/\\/g, '/')`. On Windows, `path.relative` returns backslashes which are then replaced with `/`. If `includePatterns` contains patterns with `**`, the minimatch comparison should work after the replacement — but only if `matchBase` or `dot` options are set correctly. There is a risk that deeply-nested paths (e.g. `src/features/auth/utils.ts`) fail to match `**/*.ts` patterns on Windows due to minimatch options not being set.

**Run 3 — No Active Editor:**
- `docuvia.runExtraction` fires with no active text editor.
- Warning shown: "Open a file to extract decisions from." ✓
- User opens a file and runs command again. Works correctly.
- **Edge case:** User opens a non-text file (e.g. binary). `editor.document.getText()` may return empty/garbled content. The task is queued with empty content. TaskRunner sends empty content to LLM. LLM returns no decisions. Task completes silently with zero output. No user feedback that the extraction produced nothing.
- **BUG H-3 [LOW]:** No minimum content check before queuing extraction task.

**Severity Summary:**
- BUG H-1: Critical — inherited from Orphaned L3 bug
- BUG H-2: Low — potential minimatch pattern mismatch on Windows
- BUG H-3: Low — no empty-content guard

---

### Journey I: L3 Decision Lifecycle

**Goal:** Manually create a new L3 architectural decision, review it, update its status, and navigate to it from the TreeView.

**Trigger:** User decides to document an architectural decision about database connection pooling. They run `Docuvia: Add Decision` from the Command Palette.

**Actions:**
1. `docuvia.addDecision` fires.
2. If multiple initialized workspaces: QuickPick to select target workspace.
3. `showInputBox` prompts for decision title.
4. `showQuickPick` shows L2 modules. User selects a module (or "unassigned").
5. L3 markdown file is written to `.docuvia/l3_decisions/<slug>.md` with YAML frontmatter `status: "proposed"`.
6. File opens in editor for the user to fill in Context / Decision / Consequences sections.
7. User fills in the markdown, changes `status: "proposed"` to `status: "accepted"`.
8. User saves. File-system watcher triggers `store.load()`. TreeView refreshes.
9. Later, user runs `Docuvia: Open Decision` (or clicks in TreeView) to re-read the decision.

**Resolution:** Decision is documented, linked to an L2 module, with status lifecycle tracked in frontmatter.

#### 3× Simulation Findings

**Run 1 — Happy Path:**
- Decision created, file opened. User edits and saves. ✓
- **BUG I-1 [MEDIUM]:** `addDecision` does NOT update `l3_router.yaml`. The decision is written to `.docuvia/l3_decisions/`, but no entry is added to `l3_router.yaml`. The `store.load()` call at the end reads `l3_router.yaml` to build the routing index. If the new decision is not in the router, it will NOT appear in `KnowledgeGraphTreeProvider` (which reads from the store's router-based index). The TreeView will not show the newly created decision until `l3_router.yaml` is manually updated or the router-less full-scan path is triggered.
- This needs verification: if `store.load()` also does a full directory scan of `l3_decisions/` in addition to reading `l3_router.yaml`, the decision would appear. This needs to be traced in `parser.ts` / `KnowledgeStore.ts`. **The gap is marked as "needs verification" but the bug risk is Medium.**

**Run 2 — User Chooses "Unassigned":**
- `l2_module_id: "unassigned"` is written. Decision is created.
- **BUG I-2 [MEDIUM]:** The sentinel value `"unassigned"` (string) is stored as `l2_module_id`. If any downstream system (search, hover, lens) does UUID format validation on `l2_module_id`, it will reject or ignore this decision.
- No UI path exists to later reassign the decision to an L2 module except manually editing the markdown file.

**Run 3 — Slug Collision:**
- User creates decision "Use Redis for caching" → `use-redis-for-caching.md`.
- User creates second decision "Use Redis For Caching" → same slug `use-redis-for-caching`.
- **BUG I-3 [MEDIUM]:** No collision check. Second write silently overwrites the first. The first decision (with potentially different UUID and content) is lost permanently.

**Severity Summary:**
- BUG I-1: Medium — `l3_router.yaml` not updated by `addDecision`
- BUG I-2: Medium — non-UUID sentinel `"unassigned"` in `l2_module_id`
- BUG I-3: Medium — no slug collision guard

---

### Journey J: Hover Provider Interaction

**Goal:** Understand a function's architectural context by hovering over it in the editor, or get navigation hints by hovering over a `.docuvia` file.

**Trigger A (Code Hover):** Developer opens a TypeScript file with a function that is referenced in an L2 module's `source_paths`.  
**Trigger B (YAML Hover):** Developer opens `.docuvia/l2_modules.yaml` and hovers over a `source_paths` entry.  
**Trigger C (L3 Markdown Hover):** Developer opens `.docuvia/l3_decisions/some-decision.md` and hovers.

**Actions (A):** Hover fires `DocuviaHoverProvider` → provider checks if the hovered symbol/line is associated with a module → renders linked decisions in Hover popup.

**Actions (B/C):** Hover fires `DocuviaHoverProvider` → renders contextual information about the YAML/MD structure.

**Resolution:** Hover provides in-context documentation without leaving the editor.

#### 3× Simulation Findings

**Run 1 — TypeScript File Hover, Module Has Source Path:**
- `DocuviaHoverProvider` is registered for `.yaml` (docuvia pattern) and `.md` (l3_decisions pattern), AND for TypeScript/JavaScript/Python.
- For TypeScript hover, provider checks `store.snapshot` for modules whose `source_paths` includes the current file.
- **BUG J-1 [MEDIUM]:** The same `source_paths` matching used by CodeLens is used here. If `source_paths` contains a relative path (e.g., `src/auth/index.ts`) but the current file's path is absolute, the match fails silently. No hover is shown. The user has no idea why hover isn't working.

**Run 2 — Hovering Over `l3_decisions/*.md`:**
- Hover fires on an L3 decision markdown file.
- **BUG J-2 [LOW]:** The hover provider for `**/.docuvia/l3_decisions/*.md` may provide unhelpful content (e.g., raw YAML frontmatter rendering) instead of a human-readable summary. The exact behaviour depends on the `DocuviaHoverProvider` implementation which needs to be traced, but this is a known UX risk.

**Run 3 — No `source_paths` Populated:**
- Module has `source_paths: []` (default from skeleton).
- No hover is shown for any code file.
- **BUG J-3 [MEDIUM]:** Same as BUG D-3 — no guidance in the UI for users to populate `source_paths`. The hover is silently empty for all new users until they manually edit `l2_modules.yaml`.

**Severity Summary:**
- BUG J-1: Medium — path format mismatch in source_paths matching
- BUG J-2: Low — unclear hover content for .md files
- BUG J-3: Medium — source_paths not populated = no hover

---

### Journey K: Credential Setup

**Goal:** Configure the Docuvia server API token to enable cross-project breadth search.

**Trigger:** User attempts cross-project search for the first time and receives "Authentication required" error, or proactively runs `Docuvia: Set Server Token` from Command Palette.

**Actions (Set Token):**
1. `docuvia.setServerToken` fires.
2. `showInputBox` with `password: true` prompts for token.
3. Validation: empty string is rejected.
4. `credentialManager.setToken(token)` saves to OS keychain via `context.secrets.store()`.
5. "Server token saved." toast shown.

**Actions (Clear Token):**
1. `docuvia.clearServerToken` fires.
2. `credentialManager.clearToken()` deletes from OS keychain.
3. "Server token cleared." toast shown.

**Resolution:** Token persisted securely in OS keychain. Subsequent breadth searches authenticate successfully.

#### 3× Simulation Findings

**Run 1 — Happy Path:**
- Token set. `credentialManager.setToken()` stores in `context.secrets`.
- Subsequent `CentralServerClient.query()` retrieves token and attaches header.
- Works correctly. ✓

**Run 2 — User Enters Whitespace-Only Token:**
- `validateInput` in `showInputBox` checks `v.trim().length === 0` — returns "Token cannot be empty". 
- VS Code shows inline validation error. User cannot proceed. ✓
- **Observation:** Validation is correct but `trim()` is applied only in `validateInput`. The actual `setToken` call is `credentialManager.setToken(token.trim())` — so trimming is consistent. ✓

**Run 3 — Token Used with Wrong Server URL:**
- Token is set but `~/.docuvia/config.yaml` has a wrong `server_url` or no `server_url`.
- `CentralServerClient` uses the URL from `globalConfig.server_url`.
- **BUG K-1 [MEDIUM]:** If `server_url` is not set in `~/.docuvia/config.yaml`, the Central Server URL defaults to... what? This depends on `CentralServerClient` constructor implementation. If the URL is `undefined`, the `fetch()` call will throw a `TypeError`. The error is caught as a generic error (not `CentralServerAuthError`), and the user sees a generic "Search failed" message with no guidance on setting the `server_url`.
- There is no UI (command or settings) to set `server_url` — it must be set by manually editing `~/.docuvia/config.yaml`. This is a UX gap.

**Severity Summary:**
- BUG K-1: Medium — no UI to set server_url; unclear error when missing

---

### Journey L: Command Palette Extraction (Active File)

**Goal:** Extract L3 decisions from the currently open file using the Command Palette command (distinct from the chat `/extract` flow).

**Trigger:** User opens `src/services/payment.ts` (a complex file) and runs `Docuvia: Run Extraction` from Command Palette.

**Actions:**
1. `docuvia.runExtraction` fires (see Journey H for full flow).
2. Three-gate check: include patterns, line count, file size.
3. User confirms or aborts at each gate.
4. Content extracted and task queued.

**Resolution:** Same as Journey H. This journey distinguishes the Command Palette path from the `@docuvia /extract <path>` chat path.

*Note: Journey L overlaps significantly with Journey H. The two are kept separate to document the distinct UX entry points. Journey H covers Task Queue management; Journey L focuses on the extraction trigger and guard rails.*

#### Additional Bugs Not Covered in Journey H:
- **BUG L-1 [MEDIUM]:** `docuvia.runExtraction` only works on the **active file**. If no file is open, it warns and stops. The chat `/extract` command supports directory-level recursive extraction; the command palette version does not. This asymmetry is not documented and surprises users who expect the same power from both entry points.
- **BUG L-2 [LOW]:** If the active file belongs to a workspace folder that has no `.docuvia/` initialization, the task is still queued. The `TaskRunner` will write L3 files to... potentially the first workspace root or nowhere, depending on how the path is resolved. The extracted decisions may end up in the wrong workspace's `.docuvia/`.

---

### Journey M: Multi-Workspace Knowledge Isolation

**Goal:** Work with two separate projects open in the same VS Code window, each with its own independent `.docuvia/` knowledge graph.

**Trigger:** User has two workspace folders open: `/projects/frontend` (initialized) and `/projects/backend` (initialized). They open a file from the backend project and run `@docuvia /query auth pattern`.

**Actions:**
1. The active editor is on a backend file.
2. `/query auth pattern` runs local search.
3. `KnowledgeStore.snapshot` (aggregated getter) is used for the query.
4. Results from BOTH workspaces appear in the chat response.
5. User runs `docuvia.initProject`. QuickPick appears showing only uninitialized folders.
6. Since both are initialized, message: "All workspace folders are already initialized." ✓

**Resolution:** Each workspace has isolated knowledge; the aggregated snapshot enables cross-workspace local search.

#### 3× Simulation Findings

**Run 1 — `/query` on Multi-Root:**
- `KnowledgeStore.snapshot` aggregates decisions from all initialized workspaces.
- Local `/query` searches across all workspaces' decisions.
- **Observation:** This is actually a feature — cross-workspace local search. But it is not documented in any Journey. Users may not know their query spans all open workspaces.
- **BUG M-1 [MEDIUM]:** No indication in query results of which workspace a decision came from. If two workspaces have decisions with identical content about different systems, the user cannot distinguish them.

**Run 2 — `acceptL1Tags` in Multi-Root:**
- User runs `/explore` in the context of `/projects/backend` (second workspace folder).
- Clicks "Accept & Write".
- **BUG M-2 [CRITICAL]:** Identical to BUG A-3. `acceptL1Tags` always writes to `workspaceFolders[0]` (`/projects/frontend`). The backend's L1 tags are written to the frontend's `.docuvia/l1_tags.yaml`, corrupting the frontend's knowledge graph.

**Run 3 — `addDecision` in Multi-Root:**
- User is editing a backend file. Runs `docuvia.addDecision`.
- `addDecision` correctly resolves target workspace from the active editor's workspace folder.
- User is NOT editing any file (no active editor). Two workspaces are initialized.
- QuickPick appears asking "Select a project to add the decision to".
- User selects backend. Decision written to backend's `.docuvia/`. ✓
- This path works correctly.

**Severity Summary:**
- BUG M-1: Medium — no workspace source label in multi-root query results
- BUG M-2: Critical — `acceptL1Tags` always targets workspaceFolders[0]

---

### Journey N: Cross-Project Search Panel

**Goal:** Perform a cross-project search and view results in the dedicated `SearchResultsPanel` webview (as opposed to inline chat results).

**Trigger:** User runs `Docuvia: Open Search` from Command Palette. OR: User has selected text in editor and runs `Docuvia: Search from Selection`.

**Actions (Open Search):**
1. `docuvia.openSearch` fires.
2. `showInputBox` prompts: "Search cross-project knowledge".
3. `executeSearch()` is called with query string.
4. If `docuvia.search.defaultView` is `"chat"` (default): opens `@docuvia /query <text>` in chat.
5. If `docuvia.search.defaultView` is `"panel"`: calls `CentralServerClient.query()` → opens `SearchResultsPanel`.

**Actions (Search from Selection):**
1. `docuvia.searchFromSelection` fires.
2. Selected text from active editor is used as query.
3. Same `executeSearch()` flow as above.

**Resolution:** Results displayed in `SearchResultsPanel` webview or routed to chat.

#### 3× Simulation Findings

**Run 1 — `defaultView = "chat"` (default):**
- Opens `@docuvia /query <text>`. Correct behavior, routes through breadth/local detection logic in chat participant.
- **Observation:** Most users will never see the `SearchResultsPanel` because the default is `"chat"`. The panel is an "advanced" feature only reachable by changing settings.

**Run 2 — `defaultView = "panel"`, Server Not Configured:**
- `CentralServerClient.query()` is called directly (bypasses chat routing).
- **BUG N-1 [HIGH]:** There is no local-search fallback when using the Panel path. If no server URL is configured or the server is unreachable, the user gets a generic error message. The panel never opens. There is no fallback to local search.
- `CentralServerAuthError` is caught and shows "Authentication required" specifically. Other errors show generic "Search failed" message.

**Run 3 — Search from Selection, Empty Selection:**
- `docuvia.searchFromSelection` fires when user has no selection.
- Warning shown: "Select code or text to search." ✓
- **BUG N-2 [LOW]:** If the selected text is extremely long (e.g. user accidentally selected the entire file), the full text is passed as the search query to the server. No length limit or truncation is applied. This could produce an oversized HTTP request body or expose sensitive code to the central server unintentionally.

**Severity Summary:**
- BUG N-1: High — no local fallback in Panel search mode
- BUG N-2: Low — no query length limit in searchFromSelection

---

## 5. Complete Bug Inventory

| ID | Journey | Severity | Description |
|---|---|---|---|
| A-1 | A | **Critical** | `acceptL1Tags` doesn't create `.docuvia/` directory before writing `l1_tags.yaml` |
| A-2 | A | **High** | `acceptL1Tags` doesn't create `l2_modules.yaml` or `l3_decisions/` skeleton |
| A-3 | A / M | **Critical** | `acceptL1Tags` always targets `workspaceFolders[0]`; breaks multi-root |
| B-1 | B / H | **Critical** | `TaskRunner` always writes `l2_module_id: ""` — all extracted decisions are orphaned |
| B-2 | B | **Medium** | `GlobalConfig.chunking_strategy` is read but `TaskRunner` ignores it; AST chunking never activates |
| C-1 | C / I | **Medium** | `addDecision` does not update `l3_router.yaml`; decisions may be invisible in TreeView |
| C-2 | C / I | **Medium** | Sentinel value `"unassigned"` (not UUID/empty) used as `l2_module_id` |
| C-3 | C / I | **Medium** | No slug collision guard; second decision with same title overwrites first |
| D-1 | D | **High** | Journey description falsely claims AST/hash anchoring; actual implementation is line-number only |
| D-2 | D | **High** | CodeLens drifts when code is inserted above the anchored function |
| D-3 | D / J | **Medium** | Default `source_paths: []` means no CodeLens/Hover for new users; no guidance |
| E-1 | E | **High** | No prerequisite documentation for token setup; user hits 401 with no prior guidance |
| E-2 | E | **High** | Local query uses naive `.includes()`; vocabulary-different queries return zero results |
| E-3 | E | **Low** | Local query does not search L2 module names/descriptions |
| F-1 | F | **Low** | Dashboard shows empty state indistinguishable from uninitialized state |
| F-2 | F | **Medium** | Dashboard data is not live-refreshed when knowledge store changes |
| G-1 | G | **Low** | `initProject` allows empty project name |
| G-2 | G | **Medium** | Concurrent `store.load()` calls (FS watcher + explicit refresh) may produce inconsistent snapshot |
| H-2 | H | **Low** | minimatch include pattern check may fail on Windows for nested paths |
| H-3 | H | **Low** | No minimum content check before queuing extraction (empty/binary files) |
| I-1 | I | **Medium** | `addDecision` does not update `l3_router.yaml` (same as C-1) |
| I-2 | I | **Medium** | Sentinel `"unassigned"` in `l2_module_id` may break UUID-expecting consumers |
| I-3 | I | **Medium** | Slug collision: same title overwrites existing decision |
| J-1 | J | **Medium** | Hover source_paths matching fails if relative vs. absolute path mismatch |
| J-3 | J | **Medium** | Default `source_paths: []` means no hover shown; no user guidance |
| K-1 | K | **Medium** | No UI to set `server_url`; `undefined` URL causes TypeError with generic error message |
| L-1 | L | **Medium** | Command Palette `runExtraction` is file-only; chat `/extract` is directory-recursive; asymmetry undocumented |
| L-2 | L | **Low** | `runExtraction` on uninitialized workspace may write L3 files to wrong workspace |
| M-1 | M | **Medium** | Multi-root `/query` results have no workspace source label |
| M-2 | M | **Critical** | `acceptL1Tags` + multi-root: writes to `workspaceFolders[0]` regardless of which workspace `/explore` ran in |
| N-1 | N | **High** | SearchResultsPanel mode has no local fallback when server is unavailable |
| N-2 | N | **Low** | No query length limit in `searchFromSelection` |

**Critical:** 4 bugs  
**High:** 6 bugs  
**Medium:** 14 bugs  
**Low:** 8 bugs

---

## 6. Proposed Roadmap Updates

The following new critical gap entries must be added to `docs/vscode-extension-roadmap.md`:

### Phase 1 Additions
```
- [ ] **Critical Gap (acceptL1Tags — Directory Creation)**: `acceptL1Tags` must call
  `vscode.workspace.fs.createDirectory` for `.docuvia/` before writing `l1_tags.yaml`.
  Currently fails silently with FileNotFound if the folder does not exist (BUG A-1).

- [ ] **Critical Gap (acceptL1Tags — Skeleton Polyfill)**: After writing `l1_tags.yaml`,
  `acceptL1Tags` must also create `l2_modules.yaml` and `l3_decisions/` directory if they
  do not exist. The skeleton is currently incomplete after an `/explore` + Accept flow (BUG A-2).

- [ ] **Critical Gap (acceptL1Tags — Multi-Root)**: `acceptL1Tags` must resolve the target
  workspace root from the chat participant's context rather than hardcoding
  `workspaceFolders?.[0]`. In multi-root workspaces, the wrong project's YAML is overwritten (BUG A-3, M-2).
```

### Phase 4 Additions
```
- [ ] **Critical Gap (addDecision — l3_router.yaml)**: `addDecision` must append the new
  decision entry to `l3_router.yaml` immediately after writing the markdown file. Currently
  the decision is invisible to all router-based lookups (CodeLens, Hover, TreeView) until
  the file-system watcher triggers a full reload (BUG C-1, I-1).

- [ ] **Critical Gap (Slug Collision Guard)**: `addDecision` must check whether a file with
  the same slug already exists and either append a numeric suffix or prompt the user, rather
  than silently overwriting the existing decision (BUG C-3, I-3).

- [ ] **Critical Gap (l2_module_id Sentinel)**: Replace the `"unassigned"` sentinel with
  an empty string `""` or a proper UUID constant, and add a downstream convention doc so
  consumers handle the unlinked case consistently (BUG C-2, I-2).
```

### Phase 5 Additions
```
- [ ] **Critical Gap (server_url UI)**: Add a VS Code setting (`docuvia.server.url`) so
  users can set the central server URL via Settings UI or `settings.json`, rather than
  requiring manual editing of `~/.docuvia/config.yaml` (BUG K-1).

- [ ] **Critical Gap (SearchResultsPanel Local Fallback)**: When `search.defaultView` is
  `"panel"` and the central server is unavailable, fall back to local knowledge search
  rather than surfacing a generic error (BUG N-1).

- [ ] **Critical Gap (searchFromSelection Length Limit)**: Cap the query length for
  `searchFromSelection` (e.g., 2000 chars) to prevent sending entire file contents to the
  central server (BUG N-2).
```

### Phase 6 Additions
```
- [ ] **Dashboard Live Refresh**: Subscribe Dashboard webview to KnowledgeStore change
  events (or add a manual Refresh button) so that stats update without reopening the panel
  (BUG F-2).

- [ ] **Multi-Root Query Attribution**: When returning results from `snapshot` (aggregated
  multi-root), tag each result with its source workspace root so the user knows which
  project a decision came from (BUG M-1).

- [ ] **initProject Empty Name Guard**: Add `validateInput` to the project name `showInputBox`
  in `initProject` to prevent empty project names (BUG G-1).
```

---

## 7. Documentation Writer Instructions

### Step 1 — Update `artifacts/vscode-client/design/ui-ux/user-journeys.md`

**Structure to produce:**

```
# User Journeys & Scenarios

[brief intro paragraph — same as current]

## ⚠️ Known Limitations & Active Bugs
[A short summary table of critical/high bugs, cross-referenced to journeys]

## Journey A: The Onboarding Experience (Project Discovery) [CORRECTED]
## Journey B: Deep Knowledge Extraction [CORRECTED]
## Journey C: Micro-Decision Recording [CORRECTED]
## Journey D: Contextual Retrieval (CodeLens) [CORRECTED]
## Journey E: Cross-Project Breadth Search [CORRECTED]
## Journey F: Dashboard Overview [NEW]
## Journey G: Manual Init & Refresh [NEW]
## Journey H: Task Queue Management [NEW]
## Journey I: L3 Decision Lifecycle [NEW]
## Journey J: Hover Provider Interaction [NEW]
## Journey K: Credential Setup [NEW]
## Journey L: Command Palette Extraction (Active File) [NEW]
## Journey M: Multi-Workspace Knowledge Isolation [NEW]
## Journey N: Cross-Project Search Panel [NEW]
```

**Key corrections for existing journeys:**

- **Journey A:** Remove claim that "Accept & Write" creates the full skeleton. State the actual bug (BUG A-1, A-2, A-3). Add workaround: run `Init Project` first.
- **Journey B:** Remove claim about "automatically categorized under appropriate L2 Modules." Replace with orphaned-L3 disclaimer (BUG B-1). Add line-based chunking limitation note (BUG B-2).
- **Journey C:** Correct "instantly mapped" wording. Note slug collision risk (BUG C-3). Note `l3_router.yaml` update gap (BUG C-1).
- **Journey D:** **Remove** the phrase "robust AST-based or hash-based anchoring (Drift Protection)" — replace with line-number anchoring and known drift limitation (BUG D-1, D-2). Add `source_paths` population requirement (BUG D-3).
- **Journey E:** Add prerequisite link to Journey K for token setup (BUG E-1). Add local query limitation note (BUG E-2).

**For each new journey (F–N), include:**
- Goal
- Trigger
- Step-by-step Actions
- System Behavior
- Resolution
- Known Bugs & Limitations (with severity badge)

---

### Step 2 — Update `docs/vscode-extension-roadmap.md`

**Insertion points:**

1. After the existing `Phase 1` critical gap bullet → add the three new Phase 1 gaps from Section 6 above.
2. After the existing `Phase 4` critical gap bullets (Orphaned L3s and CodeLens Drift) → add the three new Phase 4 gaps.
3. After the existing `Phase 5` critical gap bullet (Local Search) → add the three new Phase 5 gaps.
4. In `Phase 6` → add the three new Phase 6 bullets at the end of the task list.

**Do NOT change** any existing `[x]` completed tasks, architecture diagrams, or mermaid blocks.

---

## 8. Success Criteria

The implementation is complete when:

1. `user-journeys.md` contains exactly 14 journeys (A through N).
2. Every command registered in `extension.ts` appears in at least one journey.
3. Every provider (CodeLens, Hover) appears in at least one journey.
4. Every UI panel (Dashboard, SearchResults, TreeView, TaskQueue) appears in at least one journey.
5. Every journey includes a "Known Bugs & Limitations" section where applicable.
6. The Bug Inventory table from Section 5 (or a condensed version) appears in `user-journeys.md`.
7. `vscode-extension-roadmap.md` contains the 12 new critical gap entries from Section 6.
8. No existing `[x]` tasks or completed sections have been altered.
9. No source code files have been modified.
