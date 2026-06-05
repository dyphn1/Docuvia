# Command: Docuvia Add Decision

## Command Details

- **Command IDs**:
  - `docuvia.addDecision` (Command Palette)
  - `docuvia.addDecisionFromSelection` (Editor Right-Click Context Menu)
- **Title**: `Docuvia: Add Decision` / `Docuvia: Add Decision from Selection`
- **Registration**: Implemented in [`extension.ts`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/extension.ts).

## Functional Flow

```mermaid
flowchart TD
    Start[Trigger Add Decision] --> Selection{From selection?}
    Selection -- Yes --> Capture[Capture selection and wrap in code block]
    Selection -- No --> Workspace[Resolve Workspace Folder]
    Capture --> Workspace
    Workspace --> Metadata[Prompt for Title, generate UUID & slug]
    Metadata --> L2[QuickPick of L2 Modules]
    L2 --> Scaffold[Generate L3 Markdown with frontmatter]
    Scaffold --> Write[Write to .docuvia/l3_decisions/{slug}.md]
    Write --> Reload[Reload KnowledgeStore]
    Reload --> Open[Open Markdown file in Editor]
```

1. **Selection Handling (Optional)**:
   - If triggered via `addDecisionFromSelection`, capture the active text editor's selection and language ID.
   - Wrap the selection in markdown code blocks to pass as `prefillBody`.

2. **Workspace Resolution**:
   - Prefer the workspace folder of the active text editor if available and initialized.
   - If unable to resolve via editor context:
     - Check initialized workspaces in the store.
     - If exactly 1, use it.
     - If > 1, prompt the user with a `QuickPick` to choose the target initialized project.
     - If 0, show an error requiring the user to run `Init Project` first.

3. **Metadata Gathering**:
   - Prompt the user for a "Decision title".
   - Generate a UUID for the decision.
   - Generate a slugified filename based on the title.
   - Capture current date.

4. **Module Assignment (L2)**:
   - Load the `snapshot.modules` for the target workspace.
   - Present a `QuickPick` of available L2 Modules.
   - Always append an option: `$(add) Create new module later... (unassigned)`. This prevents blocking users who haven't set up L2 modules yet.

5. **File Generation**:
   - Generate YAML frontmatter containing `id`, `l2_module_id`, `title`, `date`, and `status`.
   - If the user selected `(unassigned)` during module assignment, explicitly set `l2_module_id: unassigned` in the frontmatter.
   - Generate the markdown body sections (`## Context`, `## Decision`, `## Consequences`).
   - If `prefillBody` was provided, inject it into the `## Context` section.
   - Write the file to `.docuvia/l3_decisions/{slug}.md`.

6. **Post-Action**:
   - Force a [`KnowledgeStore`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/KnowledgeStore.ts) reload to ensure the UI is immediately aware of the new file.
   - Open the newly created markdown file in the editor so the user can finish filling it out.
