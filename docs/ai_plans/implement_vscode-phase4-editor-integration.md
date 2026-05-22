# Implementation Plan: VS Code Extension — Phase 4: Editor Integration (Deep Context)

**Date**: 2026-05-22  
**Roadmap Reference**: `docs/vscode-extension-roadmap.md` — Phase 4  
**Affected Workspace Package**: `artifacts/vscode-client`

---

## 1. Implementation Goals

| # | Goal | Verifiable Success Criterion |
|---|------|------------------------------|
| G1 | CodeLens provider shows `🧠 Docuvia: N Decisions` above function/class declarations in TS/JS/Python files whose workspace-relative path matches any L2 module `source_paths` entry. | Opening a file whose path prefix matches an L2 module with linked L3 decisions renders at least one CodeLens label matching `🧠 Docuvia: \d+ Decisions?`. |
| G2 | Clicking a CodeLens opens a QuickPick with up to 2 most relevant L3 decisions; if more exist, a "View all in Chat" option appears. | Clicking the lens on a module with 3+ decisions shows exactly 2 decision items plus one "View all in Chat" item in the QuickPick. |
| G3 | CodeLens refreshes when `KnowledgeStore.onDidLoad` fires. | Saving a new `.md` to `.docuvia/l3_decisions/` causes visible CodeLens count to update without reloading the window. |
| G4 | Hover Provider is active only in `.docuvia/*.yaml` and `.docuvia/l3_decisions/*.md` files. Hovering over a UUID shows a formatted hover card. | Hovering over a valid UUID string in `l2_modules.yaml` renders a Hover popup containing the entity's name and description. |
| G5 | `docuvia.addDecisionFromSelection` command is visible in the editor context menu for TS/JS/Python files when text is selected. | Right-clicking on selected TypeScript code shows "Docuvia: Add Decision from Selection". Running it pre-fills the decision Markdown body with the selected code in a fenced code block. |

---

## 2. Current Implementation Baseline

### Existing source files (`artifacts/vscode-client/src/`)

| File | Role |
|------|------|
| `types.ts` | Zod schemas + types for `L1Tag`, `L2Module`, `L3Decision`, `L3RouterEntry`, `GlobalConfig` |
| `parser.ts` | File parsers for YAML/Markdown using `gray-matter` + `yaml` |
| `KnowledgeStore.ts` | Singleton in-memory store; `snapshot` getter; `onDidLoad` event; helpers `getDecisionById`, `getModulesByTagId`, `getRouterEntriesByModuleId` |
| `KnowledgeGraphTreeProvider.ts` | Sidebar TreeView (L1 → L2 → L3) |
| `TaskQueueTreeProvider.ts` | Sidebar TreeView for task queue |
| `DashboardPanel.ts` | Webview Dashboard |
| `ChatParticipant.ts` | `@docuvia` chat participant |
| `TaskRunner.ts` | Background extraction task queue |
| `extension.ts` | `activate()` + all command registrations; includes `addDecision()` helper function |

### Key data structures relevant to Phase 4

```typescript
// L2Module.source_paths — relative paths within workspace
// e.g. ["src/api/", "src/routes/"]
interface L2Module {
  id: string;
  slug: string;
  name: string;
  description?: string;
  l1_tag_id: string;
  source_paths: string[];
}

// KnowledgeStore.snapshot accessor
interface KnowledgeGraphSnapshot {
  tags: L1Tag[];
  modules: L2Module[];
  routerIndex: L3RouterEntry[];
  decisions: Map<string, L3Decision>;
  loadedAt: Date;
}
```

### Existing `addDecision()` function signature (in `extension.ts`)

```typescript
async function addDecision(
  _context: vscode.ExtensionContext,
  store: KnowledgeStore
): Promise<void>
```

It prompts for title, picks an L2 module via QuickPick, writes a `.md` file with YAML frontmatter, and opens the file in the editor.

---

## 3. New Files

### 3.1 `DocuviaCodeLensProvider.ts`

**Full path**: `artifacts/vscode-client/src/DocuviaCodeLensProvider.ts`

#### Responsibilities
- Implements `vscode.CodeLensProvider`
- Scans open documents for top-level function and class declarations
- Matches the document to L2 modules via `source_paths`
- Emits one CodeLens per matched declaration
- Fires `_onDidChangeCodeLenses` when the knowledge store reloads

#### Internal interface

```typescript
interface CodeLensDecisionData {
  moduleId: string;
  moduleName: string;
  decisionIds: string[];  // all decision IDs for this module
}
```

#### Document language selectors

```typescript
const CODELENS_SELECTOR: vscode.DocumentSelector = [
  { language: 'typescript' },
  { language: 'javascript' },
  { language: 'typescriptreact' },
  { language: 'javascriptreact' },
  { language: 'python' },
];
```

#### File-to-module matching algorithm

Given `documentFsPath` (absolute OS path) and `workspaceRoot` (absolute OS path):

1. Compute `relPath = path.relative(workspaceRoot, documentFsPath).split(path.sep).join('/')` (forward-slash normalized).
2. For each L2 module in `store.snapshot.modules`, iterate `module.source_paths`.
3. Normalize each source path entry: strip leading `./` and ensure trailing `/` for directory prefixes (unless the entry has a file extension).
4. A document **matches** a module when `relPath === sourcePath` OR `relPath.startsWith(sourcePath)`.
5. Collect all matching modules. If none match, return `[]` early.

#### Function/class declaration regex patterns

```typescript
const PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/m,         // function declaration
    /^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/m,         // class declaration
  ],
  javascript: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/m,
    /^\s*(?:export\s+)?class\s+\w+/m,
  ],
  typescriptreact:   /* same as typescript */,
  javascriptreact:   /* same as javascript */,
  python: [
    /^\s*(?:async\s+)?def\s+\w+/m,
    /^\s*class\s+\w+/m,
  ],
};
```

Scan is done line-by-line over the full document text. For each line that matches any pattern, record `(lineIndex, pattern)`.

#### `provideCodeLenses` implementation outline

```typescript
provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
  const snapshot = this._store.snapshot;
  if (!snapshot) return [];

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return [];

  // Step 1: find matching modules
  const matchedModules = findMatchingModules(document.uri.fsPath, workspaceRoot, snapshot.modules);
  if (matchedModules.length === 0) return [];

  // Step 2: compute decisions per matched module
  const moduleData: CodeLensDecisionData[] = matchedModules.map(module => {
    const decisionIds = snapshot.routerIndex
      .filter(r => r.l2_module_id === module.id)
      .map(r => r.id);
    return { moduleId: module.id, moduleName: module.name, decisionIds };
  }).filter(d => d.decisionIds.length > 0);

  if (moduleData.length === 0) return [];

  // Step 3: scan document for declaration lines
  const declarationLines = findDeclarationLines(document);

  // Step 4: emit one CodeLens per declaration × module (or aggregate if multiple modules match)
  // Strategy: one CodeLens per declaration line, using the best-matched (most decisions) module
  const bestModule = moduleData.sort((a, b) => b.decisionIds.length - a.decisionIds.length)[0];

  return declarationLines.map(lineIndex => {
    const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
    const count = bestModule.decisionIds.length;
    return new vscode.CodeLens(range, {
      title: `🧠 Docuvia: ${count} ${count === 1 ? 'Decision' : 'Decisions'}`,
      command: 'docuvia.showDecisionsForLens',
      arguments: [bestModule],
    });
  });
}
```

#### `docuvia.showDecisionsForLens` command handler (registered in `extension.ts`)

```typescript
async function showDecisionsForLens(
  store: KnowledgeStore,
  data: CodeLensDecisionData
): Promise<void> {
  const snapshot = store.snapshot;
  if (!snapshot) return;

  const MAX_INLINE = 2;
  const allIds = data.decisionIds;
  const topIds = allIds.slice(0, MAX_INLINE);

  type QuickPickItem = vscode.QuickPickItem & { decisionId?: string; viewAll?: boolean };

  const items: QuickPickItem[] = topIds.map(id => {
    const decision = snapshot.decisions.get(id);
    return {
      label: decision?.title ?? id,
      description: decision?.status,
      decisionId: id,
    };
  });

  if (allIds.length > MAX_INLINE) {
    items.push({
      label: '$(comment-discussion) View all in Chat',
      description: `${allIds.length} decisions — open @docuvia /query`,
      viewAll: true,
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Decisions for module: ${data.moduleName}`,
  });
  if (!picked) return;

  if (picked.viewAll) {
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: `@docuvia /query ${data.moduleName}`,
    });
    return;
  }

  if (picked.decisionId) {
    const decision = snapshot.decisions.get(picked.decisionId);
    if (decision?.filePath) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(decision.filePath));
      await vscode.window.showTextDocument(doc);
    }
  }
}
```

#### Refresh wiring

```typescript
constructor(store: KnowledgeStore, context: vscode.ExtensionContext) {
  this._store = store;
  store.onDidLoad(() => this._onDidChangeCodeLenses.fire(), null, context.subscriptions);
}
```

---

### 3.2 `DocuviaHoverProvider.ts`

**Full path**: `artifacts/vscode-client/src/DocuviaHoverProvider.ts`

#### Responsibilities
- Implements `vscode.HoverProvider`
- Active **only** for files matching `.docuvia/*.yaml` and `.docuvia/l3_decisions/*.md`
- On hover, detects UUIDs and looks them up in the knowledge store

#### Document selector

```typescript
const HOVER_SELECTOR: vscode.DocumentSelector = [
  { language: 'yaml', pattern: '**/.docuvia/*.yaml' },
  { language: 'markdown', pattern: '**/.docuvia/l3_decisions/*.md' },
];
```

> **Note on language IDs**: VS Code assigns `yaml` to `.yaml` files when the YAML language extension is installed. `markdown` is a built-in language. The `pattern` glob is workspace-relative using `**` prefix to match any workspace root.

#### UUID detection

```typescript
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
```

Extract the word range at hover position. If it matches the UUID pattern, proceed.

#### `provideHover` implementation outline

```typescript
provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
  const snapshot = this._store.snapshot;
  if (!snapshot) return undefined;

  const wordRange = document.getWordRangeAtPosition(position, UUID_REGEX);
  if (!wordRange) return undefined;

  const id = document.getText(wordRange);

  // Priority 1: L3 Decision
  const decision = snapshot.decisions.get(id);
  if (decision) {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.appendMarkdown(`**L3 Decision** — ${decision.title}\n\n`);
    md.appendMarkdown(`**Status**: \`${decision.status}\`\n\n`);
    if (decision.body) {
      const preview = decision.body.slice(0, 200) + (decision.body.length > 200 ? '…' : '');
      md.appendMarkdown(`---\n\n${preview}`);
    }
    return new vscode.Hover(md, wordRange);
  }

  // Priority 2: L2 Module
  const module = snapshot.modules.find(m => m.id === id);
  if (module) {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.appendMarkdown(`**L2 Module** — ${module.name}\n\n`);
    if (module.description) {
      md.appendMarkdown(`${module.description}\n\n`);
    }
    if (module.source_paths.length > 0) {
      md.appendMarkdown(`**Source paths**: \`${module.source_paths.join('`, `')}\``);
    }
    return new vscode.Hover(md, wordRange);
  }

  // Priority 3: L1 Tag
  const tag = snapshot.tags.find(t => t.id === id);
  if (tag) {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.appendMarkdown(`**L1 Tag** — ${tag.name}\n\n`);
    if (tag.description) {
      md.appendMarkdown(tag.description);
    }
    return new vscode.Hover(md, wordRange);
  }

  return undefined;
}
```

> **Security note**: `md.isTrusted = false` is intentional — hover content may originate from user-authored YAML/Markdown files; we must not allow command URIs or HTML injection. Avoid setting `isTrusted = true`.

---

## 4. Modified Files

### 4.1 `extension.ts` — Changes Required

#### A. New imports (add at top)

```typescript
import { DocuviaCodeLensProvider } from './DocuviaCodeLensProvider.js';
import { DocuviaHoverProvider } from './DocuviaHoverProvider.js';
```

#### B. Register CodeLens provider (after TreeProvider registrations)

```typescript
// ─── CodeLens Provider ────────────────────────────────────────────────────────

const codeLensProvider = new DocuviaCodeLensProvider(store, context);
context.subscriptions.push(
  vscode.languages.registerCodeLensProvider(
    [
      { language: 'typescript' },
      { language: 'javascript' },
      { language: 'typescriptreact' },
      { language: 'javascriptreact' },
      { language: 'python' },
    ],
    codeLensProvider
  )
);
```

#### C. Register Hover provider

```typescript
// ─── Hover Provider ───────────────────────────────────────────────────────────

const hoverProvider = new DocuviaHoverProvider(store);
context.subscriptions.push(
  vscode.languages.registerHoverProvider(
    [
      { language: 'yaml', pattern: '**/.docuvia/*.yaml' },
      { language: 'markdown', pattern: '**/.docuvia/l3_decisions/*.md' },
    ],
    hoverProvider
  )
);
```

#### D. Register `docuvia.showDecisionsForLens` command

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand(
    'docuvia.showDecisionsForLens',
    async (data: CodeLensDecisionData) => {
      await showDecisionsForLens(store, data);
    }
  )
);
```

Import the `CodeLensDecisionData` type from `DocuviaCodeLensProvider.ts` (export it from there).

#### E. Register `docuvia.addDecisionFromSelection` command

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('docuvia.addDecisionFromSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showWarningMessage('Docuvia: Select code first.');
      return;
    }
    const selectedText = editor.document.getText(editor.selection);
    const langId = editor.document.languageId;
    const prefillBody = `\`\`\`${langId}\n${selectedText}\n\`\`\``;
    await addDecision(context, store, prefillBody);
  })
);
```

#### F. Modify `addDecision()` to accept optional `prefillBody`

```typescript
async function addDecision(
  _context: vscode.ExtensionContext,
  store: KnowledgeStore,
  prefillBody?: string   // NEW optional parameter
): Promise<void> {
  // ... existing logic unchanged until template string ...

  const bodySection = prefillBody
    ? `## Context\n\n${prefillBody}\n\n## Decision\n\n<!-- What was decided? -->\n\n## Consequences\n\n<!-- What are the trade-offs? -->\n`
    : `## Context\n\n<!-- Why is this decision needed? -->\n\n## Decision\n\n<!-- What was decided? -->\n\n## Consequences\n\n<!-- What are the trade-offs? -->\n`;

  const template = `${frontmatter}\n\n${bodySection}`;
  // ... rest unchanged ...
}
```

---

### 4.2 `package.json` — Changes Required

#### A. Add `docuvia.addDecisionFromSelection` command

In the `contributes.commands` array, append:

```json
{
  "command": "docuvia.addDecisionFromSelection",
  "title": "Docuvia: Add Decision from Selection"
}
```

#### B. Add `docuvia.showDecisionsForLens` command (internal, never shown in palette)

```json
{
  "command": "docuvia.showDecisionsForLens",
  "title": "Docuvia: Show Decisions for Lens (internal)",
  "enablement": "never"
}
```

#### C. Add `editor/context` menu entry for the new command

In `contributes.menus.editor/context`, append:

```json
{
  "command": "docuvia.addDecisionFromSelection",
  "when": "editorHasSelection && resourceLangId =~ /typescript|javascript|typescriptreact|javascriptreact|python/",
  "group": "docuvia"
}
```

---

## 5. Architecture Diagram

```
User opens TS/JS/Python file
           │
           ▼
DocuviaCodeLensProvider.provideCodeLenses()
           │
           ├─ findMatchingModules(fsPath, workspaceRoot, modules)
           │       normalizes relPath, matches against module.source_paths
           │
           ├─ findDeclarationLines(document)
           │       regex scan → line indexes
           │
           └─ returns CodeLens[] with command: 'docuvia.showDecisionsForLens'
                       │
                       ▼
               User clicks lens
                       │
                       ▼
           showDecisionsForLens(store, data)
                       │
                       ├─ QuickPick with ≤2 decisions (open .md file on pick)
                       └─ "View all in Chat" → workbench.action.chat.open
                               @docuvia /query <moduleName>

User hovers UUID in .docuvia/*.yaml
           │
           ▼
DocuviaHoverProvider.provideHover()
           │
           ├─ getWordRangeAtPosition(UUID_REGEX)
           ├─ lookup: decisions.get(id) → L3 hover card
           ├─ lookup: modules.find(m.id === id) → L2 hover card
           └─ lookup: tags.find(t.id === id) → L1 hover card

User selects code in editor → right-click → "Add Decision from Selection"
           │
           ▼
docuvia.addDecisionFromSelection
           │
           └─ wraps in fenced code block → calls addDecision(..., prefillBody)
```

---

## 6. Detailed Implementation Steps

### Step 1 — Create `DocuviaCodeLensProvider.ts`

**File**: `artifacts/vscode-client/src/DocuviaCodeLensProvider.ts`

1. Define and export `CodeLensDecisionData` interface.
2. Define `CODELENS_SELECTOR` constant.
3. Define `DECLARATION_PATTERNS` map per language ID.
4. Implement `findMatchingModules(fsPath, workspaceRoot, modules)` helper function:
   - Normalize `relPath` using `path.relative` + forward-slash conversion.
   - For each module, for each source_path entry: normalize (strip `./`, ensure trailing `/` for directory-style entries), check `relPath === normalized || relPath.startsWith(normalized)`.
5. Implement `findDeclarationLines(document)` helper:
   - Get all language patterns for `document.languageId` (fall back to empty array).
   - Iterate lines 0..`document.lineCount-1`, run patterns on each `document.lineAt(i).text`.
   - Return `number[]` of matched line indexes.
6. Implement `DocuviaCodeLensProvider` class:
   - Constructor: accept `KnowledgeStore` + `vscode.ExtensionContext`; subscribe `store.onDidLoad` to fire `_onDidChangeCodeLenses`.
   - Implement `onDidChangeCodeLenses` event.
   - Implement `provideCodeLenses()` as described in §3.1.
   - Implement `resolveCodeLens()` as a no-op (lenses are fully resolved in `provideCodeLenses`).

**Success criterion for Step 1**: TypeScript compiles without errors (`pnpm --filter @workspace/vscode-client run typecheck`).

---

### Step 2 — Create `DocuviaHoverProvider.ts`

**File**: `artifacts/vscode-client/src/DocuviaHoverProvider.ts`

1. Define `UUID_REGEX` constant.
2. Implement `DocuviaHoverProvider` class:
   - Constructor accepts `KnowledgeStore`.
   - Implement `provideHover()` as described in §3.2.
   - Set `md.isTrusted = false` on all `MarkdownString` instances.

**Success criterion for Step 2**: TypeScript compiles without errors.

---

### Step 3 — Modify `extension.ts`

1. Add imports for both new providers.
2. Register `DocuviaCodeLensProvider` with `vscode.languages.registerCodeLensProvider()`.
3. Register `DocuviaHoverProvider` with `vscode.languages.registerHoverProvider()`.
4. Register `docuvia.showDecisionsForLens` command calling `showDecisionsForLens(store, data)`.
5. Register `docuvia.addDecisionFromSelection` command.
6. Modify `addDecision` function signature and body template (optional `prefillBody` parameter).
7. Add the `showDecisionsForLens` module-level function.

**Success criterion for Step 3**: `pnpm --filter @workspace/vscode-client run typecheck` passes with zero errors.

---

### Step 4 — Modify `package.json`

1. Add `docuvia.addDecisionFromSelection` to `contributes.commands`.
2. Add `docuvia.showDecisionsForLens` (with `"enablement": "never"`) to `contributes.commands`.
3. Add the context menu entry for `docuvia.addDecisionFromSelection` to `contributes.menus.editor/context`.

**Success criterion for Step 4**: VS Code Extension Host starts without activation errors; right-clicking selected TypeScript code shows "Docuvia: Add Decision from Selection" in the context menu.

---

### Step 5 — End-to-End Smoke Test

Using a workspace that has a populated `.docuvia/` folder:

1. Open a TypeScript file whose path matches an L2 module `source_paths` entry.
2. Verify CodeLens labels `🧠 Docuvia: N Decisions` appear above function/class declarations.
3. Click a lens with ≤2 decisions → QuickPick shows N items, clicking one opens the `.md` file.
4. Click a lens with >2 decisions → QuickPick shows 2 items + "View all in Chat".
5. Click "View all in Chat" → Chat opens with `@docuvia /query <moduleName>` pre-filled.
6. Open `.docuvia/l2_modules.yaml` → hover over a UUID value → popup shows L2 module name + source paths.
7. Select code in a TypeScript file → right-click → "Docuvia: Add Decision from Selection" → QuickPick for module appears → after selection, `.md` file opens with selected code in a fenced block under `## Context`.

---

## 7. Affected Package

- `artifacts/vscode-client` (only)  
- No database, API spec, or frontend changes required.  
- No new npm dependencies required (`vscode` API is sufficient).

---

## 8. Files Summary

| File | Action |
|------|--------|
| `artifacts/vscode-client/src/DocuviaCodeLensProvider.ts` | **Create** (new) |
| `artifacts/vscode-client/src/DocuviaHoverProvider.ts` | **Create** (new) |
| `artifacts/vscode-client/src/extension.ts` | **Modify** (imports, provider registrations, new command, `addDecision` signature) |
| `artifacts/vscode-client/package.json` | **Modify** (2 new commands, 1 new context menu entry) |

---

## 9. Out of Scope

- Phase 5 (Central Server Breadth Search) — not part of this plan.
- CodeLens for arrow function expressions (`const foo = () => {}`) — deferred; regex-based scanning makes this unreliable without a full AST parser.
- Hover in arbitrary source files for L3 decisions — intentionally restricted to `.docuvia/` files to avoid noise (per roadmap decision).
- Unit tests — deferred to a separate test implementation task.
