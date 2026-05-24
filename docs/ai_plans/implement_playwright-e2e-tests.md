# Implement Playwright E2E Tests for Docuvia VS Code Extension

**Date:** 2026-05-23  
**Author:** Requirement Analyzer Agent  
**Target:** `artifacts/vscode-client/`  
**VS Code executable:** `D:\VSCode\Code.exe`

---

## 1. Implementation Goals

Complete and make pass the Playwright/E2E test suite for the Docuvia VS Code extension. Each test must produce observable, verifiable outcomes — no assertions that trivially pass without exercising real extension behavior.

**In scope:**
- Phase 1: File system changes in fixture workspace after `initProject`
- Phase 2: Dashboard webview DOM state
- Phase 3: `@docuvia` chat participant interaction
- Shared infrastructure: launch helpers, temp user-data-dir, fixture cleanup

**Not in scope:** `src/tests/phase1.test.ts` (Mocha/VS Code test runner unit tests — separate runner).

**Verifiable success:** Running `npx playwright test` from `artifacts/vscode-client/` exits with code 0 and all tests have a `passed` status in the HTML report.

---

## 2. Critical Bugs in the Existing `tests/phase1.spec.ts`

These must be fixed before any new tests are added:

| # | Bug | Location | Fix |
|---|-----|----------|-----|
| B1 | `--disable-extensions` will block the Copilot Chat runtime (needed for `vscode.chat` API). Remove it. For phases 1–2 it is not strictly needed; for phase 3 it must not be present. | `tests/phase1.spec.ts`, line 21 | Remove `'--disable-extensions'` from the args array |
| B2 | No `--user-data-dir`. VS Code writes extensions, state, and keybindings into the real user profile, polluting it across test runs. | `tests/phase1.spec.ts`, launch args | Add `--user-data-dir=<os.tmpdir()/docuvia-test-profile-<random>>` |
| B3 | `.docuvia` folder created by `initProject` is never cleaned up. Subsequent test runs start with a non-empty workspace. | `tests/phase1.spec.ts`, `afterAll` | Add `fs.rmSync(docuviaPath, { recursive: true, force: true })` in `afterAll` |
| B4 | `waitForSelector('.quick-input-widget')` after pressing Enter on the command palette races with the palette's own close animation. The same CSS class is shared by both the palette and `showInputBox`. | `tests/phase1.spec.ts`, test body | Replace with `waitForSelector('.quick-input-widget .input-placeholder', { state: 'attached', timeout: 6000 })` — the placeholder div is only rendered inside a real `showInputBox`, not the command palette header. Alternatively, add a short `waitForTimeout(400)` before calling `waitForSelector` again. |
| B5 | The test asserts `welcomeView NOT visible`, but never first asserts it IS visible (before init). This means the test trivially passes even if the Welcome View was never shown. | `tests/phase1.spec.ts` | Add an assertion before the command: `await expect(welcomeView).toBeVisible({ timeout: 8000 })` |
| B6 | The Docuvia Activity Bar icon is never clicked before asserting Welcome View visibility. The sidebar panel must be expanded for the view to render in the DOM. | `tests/phase1.spec.ts`, `beforeAll` | Add sidebar open step in `beforeAll` |

---

## 3. Required Extension Source Code Fixes

### 3.1 `package.json` — Activation Events

**Problem:** `"activationEvents": ["workspaceContains:.docuvia"]` means the extension does NOT activate in an empty workspace. The command `docuvia.initProject` will not be registered until the user already has a `.docuvia` folder — a chicken-and-egg problem.

**Fix:** Add `"onStartupFinished"` to the activation events array. This ensures the extension activates once VS Code fully starts, regardless of workspace contents. Keep the existing event too so the extension also activates when opening a workspace that already has `.docuvia`.

```json
// artifacts/vscode-client/package.json
"activationEvents": [
  "onStartupFinished",
  "workspaceContains:.docuvia"
]
```

**Verification:** After this change, `docuvia.initProject` must appear in the Command Palette even in a fresh empty workspace.

### 3.2 `tests/fixtures/empty-workspace/` — Minimal Workspace Marker

**Problem:** The fixture directory is completely empty. VS Code may not treat it as a real workspace folder and may show workspace-selection dialogs.

**Fix:** Create a minimal `.vscode/settings.json` inside the fixture so VS Code recognizes it as a proper folder-workspace without prompts.

**File to create:** `artifacts/vscode-client/tests/fixtures/empty-workspace/.vscode/settings.json`

```json
{}
```

This file must NOT be deleted between test runs (it is part of the fixture, not produced by the extension).

### 3.3 No changes needed in extension TypeScript source

- `docuvia:isInitialized` context key is already correctly set to `true`/`false` inside `KnowledgeStore._loadInternal()`. ✓
- Dashboard HTML already contains all required `id` attributes. ✓
- The `#open-chat-btn` button already posts `{ type: 'openChat' }` to the extension host. ✓
- `viewsWelcome` with `when: "!docuvia:isInitialized"` is already present in `package.json`. ✓

---

## 4. `playwright.config.ts` — Required Changes

Replace the existing config with:

```typescript
// artifacts/vscode-client/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,       // VS Code cold-start can take 30-60 s
  retries: 1,             // Allow one retry for flaky Electron startup
  workers: 1,             // Must be 1 — tests share a single VS Code process
  use: {
    trace: 'on-first-retry',
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
});
```

**Key changes:**
- `timeout` increased from 60 s to 120 s — VS Code startup with extension host can be slow
- `workers: 1` — mandatory; running multiple VS Code Electron processes in parallel causes port and profile conflicts
- `retries: 1` — one retry for flaky startup; not masking real failures
- `reporter` adds an HTML report for CI artifact inspection

---

## 5. Shared Test Helper

**File to create:** `artifacts/vscode-client/tests/helpers/launch.ts`

This module is imported by all spec files to avoid duplication.

```typescript
import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const VSCODE_EXE = 'D:\\VSCode\\Code.exe';
export const EXTENSION_PATH = path.join(__dirname, '..', '..');
export const WORKSPACE_FIXTURE = path.join(EXTENSION_PATH, 'tests', 'fixtures', 'empty-workspace');
export const DOCUVIA_DIR = path.join(WORKSPACE_FIXTURE, '.docuvia');

/** Create a fresh temporary VS Code user-data dir for this test run. */
export function makeTempDataDir(): string {
  const dir = path.join(os.tmpdir(), `docuvia-test-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Launch a VS Code Electron instance with the Docuvia extension loaded. */
export async function launchVSCode(opts: {
  userDataDir: string;
  disableOtherExtensions?: boolean;
}): Promise<{ electronApp: ElectronApplication; window: Page }> {
  const args: string[] = [
    `--extensionDevelopmentPath=${EXTENSION_PATH}`,
    `--user-data-dir=${opts.userDataDir}`,
    WORKSPACE_FIXTURE,
    '--new-window',
    '--no-sandbox',
    '--disable-gpu',
  ];

  // Disable extensions only when chat functionality is NOT being tested.
  // The vscode.chat API requires the GitHub Copilot Chat runtime;
  // removing this flag allows it to load from the real VS Code profile.
  if (opts.disableOtherExtensions) {
    args.unshift('--disable-extensions');
  }

  const electronApp = await electron.launch({
    executablePath: VSCODE_EXE,
    args,
  });

  const window = await electronApp.firstWindow();
  await window.waitForSelector('.monaco-workbench', { timeout: 60_000 });

  return { electronApp, window };
}

/** Wait for the Docuvia Activity Bar icon and click it to open the sidebar. */
export async function openDocuviaSidebar(window: Page): Promise<void> {
  // The Activity Bar item has an aria-label matching the viewContainer title.
  const icon = window.locator('.activitybar .action-item[aria-label="Docuvia"]');
  await icon.waitFor({ state: 'visible', timeout: 15_000 });
  await icon.click();
  // Wait for the sidebar panel to be attached
  await window.waitForSelector('.pane-header[aria-label*="Knowledge Graph"]', {
    state: 'attached',
    timeout: 10_000,
  });
}

/** Clean up the .docuvia directory created in the fixture workspace. */
export function cleanupDocuviaDir(): void {
  if (fs.existsSync(DOCUVIA_DIR)) {
    fs.rmSync(DOCUVIA_DIR, { recursive: true, force: true });
  }
}
```

---

## 6. Phase 1 Test Specification

**File:** `artifacts/vscode-client/tests/phase1.spec.ts` (full rewrite)

**Purpose:** Verify that `Docuvia: Init Project` creates the correct `.docuvia` folder structure in the fixture workspace and that the VS Code UI reflects the initialized state.

### 6.1 `beforeAll`

```
1. Call makeTempDataDir() to get a fresh user-data directory.
2. Call launchVSCode({ userDataDir, disableOtherExtensions: true }).
3. Wait for the workbench to appear (.monaco-workbench).
4. Call openDocuviaSidebar(window) so the Docuvia views are rendered in the DOM.
5. Ensure the fixture is clean: call cleanupDocuviaDir().
```

### 6.2 `afterAll`

```
1. Call cleanupDocuviaDir() to remove the .docuvia folder created during tests.
2. Call electronApp.close().
3. Optionally remove the temp user-data dir (fs.rmSync).
```

### 6.3 Individual Tests

---

#### Test 1.1 — Welcome View is visible in an empty workspace

**Name:** `Welcome View is visible when .docuvia folder does not exist`

**Steps:**
1. After `beforeAll`, the fixture has no `.docuvia` folder.
2. Look for the Welcome View content using the selector: `window.locator('.view-welcome-content', { hasText: 'Welcome to Docuvia!' })`

**Assertions:**
- `await expect(welcomeView).toBeVisible({ timeout: 10_000 })`

**Success criterion:** The selector resolves and the element is visible. This confirms `docuvia:isInitialized` is `false` at startup on an empty workspace.

**Precondition:** `onStartupFinished` activation event fix (#3.1) must be applied; otherwise the extension never activates and the Welcome View never appears.

---

#### Test 1.2 — `initProject` creates the `.docuvia` folder structure

**Name:** `Docuvia: Init Project creates .docuvia directory with skeleton YAML files`

**Steps:**
1. Assert `fs.existsSync(DOCUVIA_DIR)` is `false` at the start of this test.
2. Open command palette: `await window.keyboard.press('Control+Shift+P')`
3. Wait for command palette: `await window.waitForSelector('.quick-input-widget')`
4. Type the command: `await window.keyboard.type('Docuvia: Init Project')`
5. Select it (first result should match): `await window.keyboard.press('Enter')`
6. Wait 400 ms for the command palette to close and `showInputBox` to appear.
7. Wait for the project name input box: `await window.waitForSelector('.quick-input-widget input', { timeout: 6_000 })`
8. Clear pre-filled text and type project name:
   ```
   await window.keyboard.press('Control+A')
   await window.keyboard.type('Test Project')
   ```
9. Confirm: `await window.keyboard.press('Enter')`
10. Poll the file system for the `.docuvia` folder: `await expect.poll(() => fs.existsSync(DOCUVIA_DIR), { timeout: 12_000 }).toBe(true)`

**Assertions (all use `expect.poll` with 12 s timeout to absorb async I/O):**
- `fs.existsSync(DOCUVIA_DIR)` → `true`
- `fs.existsSync(path.join(DOCUVIA_DIR, 'l1_tags.yaml'))` → `true`
- `fs.existsSync(path.join(DOCUVIA_DIR, 'l2_modules.yaml'))` → `true`
- `fs.existsSync(path.join(DOCUVIA_DIR, 'l3_router.yaml'))` → `true`
- `fs.existsSync(path.join(DOCUVIA_DIR, 'l3_decisions'))` → `true` (directory)
- `fs.statSync(path.join(DOCUVIA_DIR, 'l3_decisions')).isDirectory()` → `true`
- Content of `l1_tags.yaml` includes the string `"Test Project"` (verify the project name was embedded)

**Success criterion:** All six file-system assertions pass within 12 seconds of `initProject` being invoked.

---

#### Test 1.3 — Welcome View disappears after init

**Name:** `Welcome View disappears after .docuvia folder is created`

**Precondition:** Test 1.2 must have run first (`.docuvia` now exists).

**Steps:**
1. Locate the Welcome View: `window.locator('.view-welcome-content', { hasText: 'Welcome to Docuvia!' })`

**Assertions:**
- `await expect(welcomeView).not.toBeVisible({ timeout: 12_000 })`

**Success criterion:** The Welcome View element is either removed from the DOM or hidden within 12 seconds of `initProject` completing. This confirms `setContext('docuvia:isInitialized', true)` was called inside `KnowledgeStore._loadInternal()`.

---

#### Test 1.4 — Knowledge Graph TreeView is present after init

**Name:** `Knowledge Graph TreeView is visible after initialization`

**Precondition:** Test 1.2 must have run first.

**Steps:**
1. Assert the tree view container is visible.
2. Selector: `.pane-body[aria-label*="Knowledge Graph"]` or `#workbench\.parts\.sidebar .views-section [aria-label*="Knowledge Graph"]`

**Assertions:**
- `await expect(treeViewPane).toBeVisible({ timeout: 10_000 })`

**Success criterion:** The Knowledge Graph panel is visible in the sidebar. (The tree may be empty since no tags/modules were added, but the pane itself must render.)

---

## 7. Phase 2 Test Specification

**File:** `artifacts/vscode-client/tests/phase2.spec.ts` (new file)

**Purpose:** Verify the Dashboard Webview renders its key DOM elements and reflects the correct initial state (all stats at 0).

### 7.1 Setup

```
beforeAll:
  1. makeTempDataDir()
  2. launchVSCode({ userDataDir, disableOtherExtensions: true })
  3. openDocuviaSidebar(window)
  4. Ensure clean state: cleanupDocuviaDir()
  5. Run Init Project programmatically (same steps as Test 1.2) to produce a .docuvia folder
     so the extension reaches isInitialized=true and the Dashboard can be opened.
  6. Open Command Palette → "Docuvia: Open Dashboard" → Enter
  7. Wait for a webview iframe to appear: await window.waitForSelector('iframe.webview.ready', { timeout: 20_000 })

afterAll:
  1. cleanupDocuviaDir()
  2. electronApp.close()
```

### 7.2 Webview Frame Access

VS Code renders webview panels inside a sandboxed `<iframe class="webview ready">`. Use Playwright's `frameLocator` API:

```typescript
// Locate the active webview frame
const webviewFrame = window.frameLocator('iframe.webview.ready').last();
```

All assertions inside Phase 2 use `webviewFrame.locator(...)` rather than `window.locator(...)`.

### 7.3 Individual Tests

---

#### Test 2.1 — Dashboard header is rendered

**Name:** `Dashboard webview renders the "Docuvia Dashboard" header`

**Steps:**
1. Locate the header element inside the webview: `webviewFrame.locator('header')`

**Assertions:**
- `await expect(header).toContainText('Docuvia Dashboard', { timeout: 15_000 })`

**Success criterion:** The webview iframe has fully loaded and the `<header>` element contains the expected title text.

---

#### Test 2.2 — Stats show zeros on a freshly initialized workspace

**Name:** `Dashboard stats show 0 tags, 0 modules, 0 decisions for empty .docuvia`

**Precondition:** The `.docuvia` folder contains only skeleton YAML files (no actual tags, modules, or decisions added yet).

**Steps:**
1. Locate each stat element by its `id` attribute inside the webview frame.

**Assertions:**
- `webviewFrame.locator('#stat-tags')` → `toHaveText('0')`
- `webviewFrame.locator('#stat-modules')` → `toHaveText('0')`
- `webviewFrame.locator('#stat-decisions')` → `toHaveText('0')`
- `webviewFrame.locator('#stat-pending')` → `toHaveText('0')`
- `webviewFrame.locator('#stat-in-progress')` → `toHaveText('0')`

All with `{ timeout: 15_000 }`.

**Success criterion:** All five numeric stat elements display "0". This confirms the `renderDashboard()` function runs correctly when the `'update'` message arrives from the extension host.

---

#### Test 2.3 — Workspace name is rendered

**Name:** `Dashboard shows the workspace name in the header`

**Steps:**
1. Locate: `webviewFrame.locator('#workspace-name')`

**Assertions:**
- `await expect(workspaceName).not.toBeEmpty({ timeout: 10_000 })`
- (Optional) `await expect(workspaceName).toContainText('empty-workspace')` — the name should match the fixture folder name.

**Success criterion:** The `#workspace-name` span is non-empty, confirming the extension host correctly passed `workspaceName` in the `DashboardPayload`.

---

#### Test 2.4 — "Ask Docuvia…" button is visible

**Name:** `Dashboard bottom bar shows the "Ask Docuvia…" chat button`

**Steps:**
1. Locate: `webviewFrame.locator('#open-chat-btn')`

**Assertions:**
- `await expect(chatBtn).toBeVisible({ timeout: 10_000 })`
- `await expect(chatBtn).toHaveText('Ask Docuvia…')`

**Success criterion:** The chat trigger button is rendered and contains the expected text.

---

#### Test 2.5 — Recent decisions placeholder is shown when empty

**Name:** `Dashboard "Recent Decisions" list shows empty placeholder when no decisions exist`

**Steps:**
1. Locate the empty placeholder: `webviewFrame.locator('#recent-decisions .empty')`

**Assertions:**
- `await expect(emptyPlaceholder).toBeVisible({ timeout: 10_000 })`
- `await expect(emptyPlaceholder).toContainText('No decisions yet.')`

**Success criterion:** The empty-state message is visible in the Recent Decisions list, confirming that `renderDashboard()` correctly handles the zero-decisions case.

---

## 8. Phase 3 Test Specification

**File:** `artifacts/vscode-client/tests/phase3.spec.ts` (new file)

**Purpose:** Verify the `@docuvia` chat participant is registered and responds correctly to `/help` and `/explore` commands.

### 8.1 Important Preconditions for Chat Tests

The VS Code Chat panel requires the `github.copilot-chat` extension runtime to expose the `vscode.chat` API. Therefore:

1. **Do NOT use `--disable-extensions`** when launching VS Code for Phase 3 tests. Using it would disable the Copilot Chat runtime and make the Chat panel unavailable.
2. The test VS Code installation at `D:\VSCode` must have GitHub Copilot Chat installed and enabled. If it is not present, chat tests should be skipped gracefully.
3. Because `--disable-extensions` is omitted, VS Code will load all installed extensions from the profile at `--user-data-dir`. Since we're using a fresh temp dir, no extensions are pre-installed there, EXCEPT for the development extension (`--extensionDevelopmentPath`) and built-in extensions. The Copilot Chat extension is a built-in component of VS Code 1.90+ and will be available from the VS Code installation itself (at `D:\VSCode`), so it will load even from a fresh profile.

### 8.2 Setup

```
beforeAll:
  1. makeTempDataDir()
  2. launchVSCode({ userDataDir, disableOtherExtensions: false }) // No --disable-extensions
  3. Wait for workbench (.monaco-workbench)
  4. Run initProject (same flow as Test 1.2) to ensure extension is active with .docuvia

afterAll:
  1. cleanupDocuviaDir()
  2. electronApp.close()
```

### 8.3 Chat Panel Opening

```typescript
// Open the chat panel via Command Palette
await window.keyboard.press('Control+Shift+P');
await window.waitForSelector('.quick-input-widget');
await window.keyboard.type('Chat: Open Chat');
await window.keyboard.press('Enter');

// Wait for the chat input to appear
const chatInput = window.locator('.interactive-input-editor .view-line').first();
await chatInput.waitFor({ state: 'visible', timeout: 20_000 });
```

Alternative shortcut (VS Code 1.90+): `Control+Alt+I`

### 8.4 Individual Tests

---

#### Test 3.1 — `@docuvia /help` returns a Markdown table

**Name:** `@docuvia /help shows help table with all supported commands`

**Steps:**
1. Open chat panel (see 8.3).
2. Click the chat input area to focus it.
3. Type `@docuvia /help` into the chat input.
4. Press Enter.
5. Wait for the response to appear: look for a `.chat-entry` or `.interactive-item-container` that contains a `<table>` or the text `/explore`.

**Selectors:**
```typescript
// VS Code chat response container (adjusts per VS Code version)
const chatResponse = window.locator('.interactive-item-container').last();
await chatResponse.waitFor({ state: 'visible', timeout: 30_000 });
```

**Assertions:**
- `await expect(chatResponse).toContainText('/explore', { timeout: 30_000 })`
- `await expect(chatResponse).toContainText('/query')`
- `await expect(chatResponse).toContainText('/extract')`
- `await expect(chatResponse).toContainText('/help')`

**Success criterion:** The last chat response item contains all four command names from the help table. This confirms: (a) the participant is registered and callable, (b) the `handleHelp()` handler returns correct Markdown.

---

#### Test 3.2 — `@docuvia /explore` responds with project type detection

**Name:** `@docuvia /explore responds with "Reading workspace files..." progress and tag suggestions`

**Steps:**
1. Ensure chat panel is open (or open it again).
2. Clear the chat input if needed.
3. Type `@docuvia /explore` and press Enter.
4. The handler reads the workspace `README.md` and `package.json`. Since the fixture has none (only an empty `.vscode/settings.json`), the extension will show the fallback interactive message.
5. Wait up to 30 s for a response.

**Assertions:**
- `await expect(chatResponse).toContainText('frontend', { timeout: 30_000 })` OR `toContainText('backend')` OR `toContainText("couldn't detect")` — at least one of these phrases should appear, confirming the explore handler ran to completion rather than throwing an unhandled error.

**Success criterion:** The chat response contains any recognizable text from `handleExplore()`. The test is deliberately loose here because the exact detection result depends on the fixture's file contents.

---

#### Test 3.3 — `@docuvia /query` with no matching term returns "No local results"

**Name:** `@docuvia /query nonexistent-term returns no-results message`

**Steps:**
1. Ensure `.docuvia` folder with skeleton YAML exists (from `beforeAll` setup).
2. Open chat and type: `@docuvia /query nonexistent-term-zzz`
3. Press Enter.
4. Wait for response.

**Assertions:**
- `await expect(chatResponse).toContainText('No local results found for', { timeout: 30_000 })`
- `await expect(chatResponse).toContainText('nonexistent-term-zzz')`

**Success criterion:** The `handleQuery()` function ran, found no matches in the (empty) knowledge graph, and returned the "no local results" message. Confirms the participant route to `handleQuery` works correctly.

---

## 9. File System and DOM State Summary

### File System State Invariants

| State | File System Condition |
|---|---|
| Before `initProject` | `DOCUVIA_DIR` does not exist |
| After `initProject` | `DOCUVIA_DIR/l1_tags.yaml`, `l2_modules.yaml`, `l3_router.yaml`, `l3_decisions/` all exist |
| After `afterAll` cleanup | `DOCUVIA_DIR` does not exist |

### DOM Selectors Reference (from `DashboardPanel.ts` HTML)

| Element | Selector | Expected Initial Value |
|---|---|---|
| Dashboard header | `header` (inside webview) | Contains "Docuvia Dashboard" |
| Workspace name | `#workspace-name` | Non-empty string |
| Tags count | `#stat-tags` | "0" |
| Modules count | `#stat-modules` | "0" |
| Decisions count | `#stat-decisions` | "0" |
| Pending tasks | `#stat-pending` | "0" |
| In-progress tasks | `#stat-in-progress` | "0" |
| Loaded at | `#stat-loaded-at` | Not "—" after init (has a timestamp) |
| Recent decisions list | `#recent-decisions` | Contains `.empty` child |
| Top modules list | `#top-modules` | Contains `.empty` child |
| Chat button | `#open-chat-btn` | Text = "Ask Docuvia…" |

---

## 10. Complete File List

| File | Action | Notes |
|---|---|---|
| `artifacts/vscode-client/package.json` | **Edit** | Add `"onStartupFinished"` to `activationEvents` |
| `artifacts/vscode-client/playwright.config.ts` | **Edit** | Full replacement (see §4) |
| `artifacts/vscode-client/tests/helpers/launch.ts` | **Create** | Shared launch helper (see §5) |
| `artifacts/vscode-client/tests/phase1.spec.ts` | **Rewrite** | Full rewrite per §6 |
| `artifacts/vscode-client/tests/phase2.spec.ts` | **Create** | Dashboard webview per §7 |
| `artifacts/vscode-client/tests/phase3.spec.ts` | **Create** | Chat participant per §8 |
| `artifacts/vscode-client/tests/fixtures/empty-workspace/.vscode/settings.json` | **Create** | Content: `{}` |

---

## 11. Execution Instructions

```bash
# From the vscode-client workspace folder
cd artifacts/vscode-client

# Build the extension first (tests run against compiled JS)
npm run compile

# Install Playwright browsers if not yet installed (only needed once)
npx playwright install

# Run all tests
npx playwright test

# Run a single spec file
npx playwright test tests/phase1.spec.ts

# View HTML report
npx playwright show-report
```

> **Note:** Tests must be run with the VS Code executable available at `D:\VSCode\Code.exe`. If run on a different machine, update `VSCODE_EXE` in `tests/helpers/launch.ts`.

---

## 12. Success Criteria (Verifiable)

| ID | Criterion |
|---|---|
| SC-1 | `npx playwright test tests/phase1.spec.ts` exits with code 0 |
| SC-2 | After Test 1.2 runs, `fs.existsSync('tests/fixtures/empty-workspace/.docuvia/l1_tags.yaml')` returns `true` |
| SC-3 | After Test 1.3 runs, the `.view-welcome-content` element with text "Welcome to Docuvia!" is not visible in the VS Code window |
| SC-4 | `npx playwright test tests/phase2.spec.ts` exits with code 0 |
| SC-5 | During Test 2.2, all five `#stat-*` elements contain the text `"0"` |
| SC-6 | During Test 2.4, `#open-chat-btn` is visible and has text `"Ask Docuvia…"` |
| SC-7 | `npx playwright test tests/phase3.spec.ts` exits with code 0 |
| SC-8 | During Test 3.1, the chat response contains `/explore`, `/query`, `/extract`, and `/help` |
| SC-9 | After all tests complete, `tests/fixtures/empty-workspace/.docuvia/` does not exist |
| SC-10 | No test modifies `D:\VSCode` or the real user VS Code profile |
