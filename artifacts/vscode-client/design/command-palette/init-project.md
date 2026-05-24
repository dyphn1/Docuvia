# Command: Docuvia Init Project

## Command Details
- **Command ID**: `docuvia.initProject`
- **Title**: `Docuvia: Init Project`
- **Activation Context**: Available globally via Command Palette, or triggered via inline tree view actions/welcome views.

## Functional Flow

1. **Workspace Resolution**:
   - Check if an explicit node was passed (e.g., from an inline tree action). If so, use `node.workspaceRoot`.
   - If no node was passed, check how many workspace folders are currently open.
   - If exactly 1, use it.
   - If multiple:
     - Filter out folders that are already initialized (have a `.docuvia` directory loaded in the store).
     - If all are initialized, show an information message and exit.
     - Display a `QuickPick` menu allowing the user to select one of the remaining uninitialized workspace folders.

2. **Project Naming**:
   - Prompt the user to enter a project name using `vscode.window.showInputBox`.
   - Prefills the input box with the directory's basename.

3. **Scaffolding (`.docuvia/`)**:
   - **Polyfill Strategy**: The command checks if target files already exist to prevent accidental deletion.
   - Create the `.docuvia` directory in the resolved workspace root.
   - Create the `.docuvia/l3_decisions` directory.
   - Generate default skeleton files **only if they do not already exist**:
     - `l1_tags.yaml` (includes the `project_name` key).
     - `l2_modules.yaml`.
     - `l3_router.yaml`.
   - **Force Overwrite**: If the target workspace is already fully initialized but the user invokes this command directly from the palette targeting that workspace, display a warning prompt: `".docuvia already exists. Do you want to overwrite existing files? This action cannot be undone."` before proceeding with destructive generation.

4. **Post-Initialization**:
   - Request the `KnowledgeStore` to reload (reading the newly created files).
   - This reload triggers the `FileSystemWatcher`, which in turn fires the UI update event.
   - Display a success message: `Docuvia: Project "<name>" initialized. Populate the YAML files to build your knowledge graph.`

## Edge Cases Handled
- User cancels project name input (silently aborts).
- User attempts to initialize when no workspace folders are open (shows error).
