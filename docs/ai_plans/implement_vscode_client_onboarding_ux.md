# Implementation Plan: VS Code Client Onboarding UX

## Implementation Goals
Update the VS Code Client design documentation (`artifacts/vscode-client/design/`) to reflect the new three-way onboarding UX, transparent artifact creation, and offline fallback logic specified in `ADR-001-vscode-client-onboarding.md` and the Tolaria First Launch principles. The design must explicitly address critical SRE edge cases, including git state validation, state corruption recovery, offline safety, and UI dead-ends.

## Approach / Methodology
We will modify the three relevant Markdown documents to describe the new "Zero to One" flow. The flow replaces the previous silent/instant scaffolding with an explicit choice (New, Connect, Demo). It mandates explicit user consent before creating `.docuvia/` or the `docuvia-knowledge` branch, implements rigorous environmental checks (git status, network state, existing artifacts), and handles offline or cancelled states cleanly to prevent friction.

## Detailed Implementation Steps

### 1. Update `knowledge-graph/init-action.md`
- **Goal:** Update the inline action workflow and handle the "Cancel Dead End".
- **Specific Changes:**
  - **Workflow Selection:** Clicking `Init` invokes `docuvia.initProject` with three options: `[✨ Initialize Knowledge Graph here (New), 🔗 Connect to Remote Graph (Existing), 📚 Clone & Explore Demo Sandbox (Demo)]`.
  - **Cancel State & `viewsWelcome`:** Explicitly define the fallback behavior if a user cancels the onboarding prompt. The Knowledge Graph tree view must use `viewsWelcome` to display a persistent state (e.g., "Docuvia: Not Initialized") containing an "Initialize Workspace" button. This prevents the tree view from becoming a permanent empty void if the user aborts.

### 2. Update `command-palette/init-project.md`
- **Goal:** Revamp the command documentation to match ADR-001 and introduce strict environmental constraints.
- **Specific Changes:**
  - **Pre-Flight Checks (The Dirty Git Tree Disaster):** Add a strict validation step before any scaffolding begins. The extension MUST run `git status --porcelain`. If the working tree is dirty, the initiation is **blocked** with a clear error: `"Please commit or stash your changes before initializing Docuvia. Creating an orphan branch requires a clean working tree."`
  - **State Corruption & Collisions:**
    - If the `docuvia-knowledge` branch already exists locally: Prompt the user to either "Connect to Existing" or "Reset/Overwrite".
    - If the `.docuvia/` folder exists but is corrupted, empty, or missing `_project_profile.yaml`: Prompt the user with a "Repair Workspace" option to rebuild missing configuration files safely.
  - **Offline Fallback (The "Connect" Black Hole):**
    - The "Connect" (remote API) option must actively ping for network connectivity. If the user is air-gapped or the API is unreachable, the "Connect" option must be clearly disabled or fail fast with a descriptive warning, preventing the UI from hanging infinitely.
    - Provide local-first heuristics as a graceful fallback for "New" initialization when the AI server is offline.
  - **Flowchart Update:** Redraw the Mermaid flowchart to illustrate the new decision tree:
    - `Trigger -> Pre-Flight Checks (Git Clean?) -> Resolve Workspace -> Show Options`.
    - Handle the split between AI-driven configuration and offline heuristic fallback.

### 3. Update `chat-participant/slash-commands.md`
- **Goal:** Document the new `@docuvia /init` slash command.
- **Specific Changes:**
  - **Flowchart:** Add the `/init` path to the master chat participant Mermaid graph, including the new failure branches for dirty working trees and network unavailability.
  - **New Section (`### /init`):**
    - **Description:** Zero to One onboarding flow via Chat.
    - **Interactive Flow:** Detail the chat card UI presenting the New, Connect, and Demo options. Explain how errors (e.g., dirty git tree, missing files) are communicated via chat error messages with actionable "Stash & Retry" or "Repair" buttons.
    - **Scaffolding Consent:** Outline the transparent generation of `l1_tags.yaml` and `_project_profile.yaml`, emphasizing the need for explicit confirmation.

## Affected Packages and Files
- `artifacts/vscode-client/design/knowledge-graph/init-action.md`
- `artifacts/vscode-client/design/command-palette/init-project.md`
- `artifacts/vscode-client/design/chat-participant/slash-commands.md`
- `package.json` (to ensure `viewsWelcome` is properly defined for the views)

## Next Steps
The Document Writer (MD) agent will execute these changes directly on the markdown files.