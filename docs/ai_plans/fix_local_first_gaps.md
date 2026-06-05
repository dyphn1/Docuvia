# Implementation Plan: Fix Local-First Gaps (Round 2)

## Implementation Goals
The goal of this task is to execute the 4 critical action items documented in `docs/design/design-flaws-and-gaps.md` to ensure the VS Code Extension functions correctly in a multi-root workspace, gracefully handles L1 Tag objects, accurately warns users on large files, and properly groups unassigned decisions. Additionally, we propose a new structure for the roadmap.

- **Goal 1:** Fix Multi-Root Scoping in `writeExtractionResults` and extension commands.
- **Goal 2:** Ensure `package.json` exposes the `docuvia.extraction.maxFileSizeKBWarning` property so `extension.ts` can consume it correctly.
- **Goal 3:** Standardize `parseTags` in `parser.ts` to handle both flat arrays and nested `{ project_name, tags }` inputs robustly.
- **Goal 4:** Ensure the `unassigned-group` virtual node accurately surfaces orphaned L3 decisions in `KnowledgeGraphTreeProvider.ts`.
- **Goal 5:** Propose an updated roadmap structure linking directly to design documents.

---

## Proposed Updated Roadmap Structure
To map the roadmap directly back to the newly created design documents (`docs/design/*.md`), the roadmap at `docs/roadmap-checklist.md` should be structurally updated. 

**Proposed Sections:**
1. **Local-First Architecture & Multi-Root Support**
   - *Reference:* `docs/design/local-first-architecture.md`, `artifacts/vscode-client/design/knowledge-graph/nodes.md`
   - *Tracking:* VS Code Tree View Nodes, Workspace Isolation, Parser Stability.
2. **Asynchronous Metabolism & Background Jobs**
   - *Reference:* `docs/design/asynchronous-metabolism.md`
   - *Tracking:* `metabolism-tick` cron triggers, Local SQLite queue, Background generation limits.
3. **Agentic RAG Routing & Swarm Intelligence**
   - *Reference:* `docs/design/agentic-rag-routing.md`
   - *Tracking:* Temporal Decay math (`last_verified_at`), O(1) Cache prior to LLM calls.
4. **Self-Evolution & Distillation**
   - *Reference:* `docs/design/self-evolution-architecture.md`
   - *Tracking:* Swarm distillation jobs, processing `correction_examples`, auto-updating `prompt_templates`.

---

## Approach / Methodology
The fixes primarily modify the `artifacts/vscode-client` workspace. 

1. **Multiroot Scoping (`TaskRunner.ts`)**:
   - Update `writeExtractionResults` signature to `writeExtractionResults(workspaceRoot: string, sourceFile: string, decisions: string[])`.
   - In `runExtractionAsync`, resolve the `workspaceRoot` by doing `vscode.workspace.getWorkspaceFolder(vscode.Uri.file(params.sourceFilePath))?.uri.fsPath`. Pass this explicitly into `writeExtractionResults` instead of relying on `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath`.

2. **Configuration Alignment (`package.json` / `extension.ts`)**:
   - Double check that `docuvia.extraction.maxFileSizeKBWarning` is registered inside `contributes.configuration.properties` in `package.json`. If missing or incorrectly mapped, inject it.
   - Verify `runExtraction` in `extension.ts` retrieves and evaluates `fileSizeKB` properly.

3. **Parser Fix (`parser.ts`)**:
   - Verify that `parseTags(content)` accommodates the `{ project_name: "MyProject", tags: [...] }` scaffold structure without throwing `.map is not a function` (if it falls back to empty arrays or breaks).
   - Add/verify defensive array-checking types to `const list = ...`.

4. **Virtual Nodes (`KnowledgeGraphTreeProvider.ts`)**:
   - Ensure the `getChildren` method for the Project level correctly evaluates L3 decisions whose `l2_module_id` is missing or `'unassigned'`, grouping them under a synthetic `unassigned-group` node.

## Detailed Implementation Steps
1. **Edit `artifacts/vscode-client/src/TaskRunner.ts`**:
   - Remove `const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;` from `writeExtractionResults`.
   - Determine `workspaceRoot` in `runExtractionAsync` and pass it down.
2. **Edit `artifacts/vscode-client/package.json`**:
   - Ensure `"docuvia.extraction.maxFileSizeKBWarning": { "type": "number", "default": 50 }` exists in configurations.
3. **Audit existing code**:
   - Check `KnowledgeGraphTreeProvider.ts` to ensure `__unassigned__` node injection logic is perfectly compliant with the design spec.
   - Check `extension.ts` for any other hardcoded `workspaceFolders[0]` (e.g. `docuvia.acceptL1Tags`).
4. **Update `docs/roadmap-checklist.md`**:
   - Apply the new structural headings mapped to design files at the end of the roadmap document.

## Affected Packages
- `@workspace/vscode-client` (`artifacts/vscode-client/src/TaskRunner.ts`, `package.json`)
- (Optional update) `docs/roadmap-checklist.md`