# L3 to L2 Analysis Workflow

## Implementation Goals
- Provide a clear, actionable workflow to bulk-analyze L3 decisions that currently lack an `l2_module_id` in `.docuvia/l3_router.yaml` (e.g., test extractions or initial parsed data).
- Map unassigned L3 entries to existing L2 modules or intelligently propose new L2 modules.
- Ensure the result is accurately persisted back to `.docuvia/l2_modules.yaml` and `.docuvia/l3_router.yaml`.

## Approach / Methodology
- Introduce a new Copilot Chat Slash Command (e.g., `@docuvia /analyze_l2`) and a corresponding command palette action (e.g., `Docuvia: Organize Pending Decisions`).
- **Data Gathering**: The task reads `l3_router.yaml` for all entries where `l2_module_id: ""`. It also reads the current `l2_modules.yaml` and `l1_tags.yaml` to provide domain context.
- **LLM Prompting**: It constructs a prompt asking the LLM to map the provided L3 decision titles/paths to the existing L2 modules. If no existing L2 module is appropriate, the LLM is instructed to propose a new L2 module.
- **Parsing and Updating**: 
  - Parse the structured JSON/YAML output from the LLM.
  - If new L2 modules are proposed, append them to `l2_modules.yaml`.
  - Update `l3_router.yaml` to fill in the correct `l2_module_id` for the processed items.
- **User Feedback**: Return a summary table to the chat showing "Mapped X items to existing modules. Created Y new modules." and provide an "Apply" button.

## Detailed Implementation Steps
1. Define the `/analyze_l2` command in `src/ChatParticipant.ts`.
2. Create a handler `handleAnalyzeL2` that fetches pending L3 decisions from `KnowledgeStore`.
3. Construct the prompt with: L1 Tags context, existing L2 Modules list, and a batched list of pending L3s.
4. Send to `request.model`.
5. Provide a custom renderer `formatAnalyzeResultAsTable()` to display the proposed mapping.
6. Register a new command `docuvia.applyL2Analysis` to execute the file writes.
7. Update the documentation in `design/chat-participant/slash-commands.md`.

## Implementation Details
- **Affected Workspace**: `artifacts/vscode-client/`
- **Files**: 
  - `src/ChatParticipant.ts`
  - `src/KnowledgeStore.ts` (add helper for `applyL2Analysis`)
  - `package.json` (register new command)
  - `design/chat-participant/slash-commands.md`

## Verifiable Success Criterion
Invoking `@docuvia /analyze_l2` on a workspace with empty `l2_module_id` records in `l3_router.yaml` generates a valid mapping table. Clicking "Apply" successfully writes the new assignments to `l3_router.yaml` and updates `l2_modules.yaml` if needed.
