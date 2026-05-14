# Implementation Plan: GitBook English Translation and UI Documentation

## Implementation Goals
1. Re-structure the GitBook documentation to strictly follow the 9-chapter format defined in `docuvia-gitbook-prompt.md`.
2. Translate all documentation (`docs/gitbook/SUMMARY.md` and the 9 markdown chapters) into English.
3. Update the documentation with visual context by capturing UI screenshots (or adding descriptive image placeholders) from the running frontend application.
4. Provide clear, step-by-step instructions on how to use each feature within the UI, mapping to the appropriate sections in the user guide.

## Approach / Methodology
1. **Translation & Restructuring**: Adjust the file structure in `docs/gitbook/` to match the 9 chapters, and translate the content entirely to English, ensuring technical accuracy and consistent terminology.
2. **UI Emulation/Observation**: Start the frontend development server (`pnpm --filter @workspace/kg-engine run dev`) to observe the actual UI state (pages, layouts, forms, buttons).
3. **UI Documentation**: Based on the running UI, write detailed usage descriptions for the features.
4. **Visual Aids**: Insert Markdown image placeholders (e.g., `![Project List View](./images/project-list.png)`) into the guides (primarily `02-user-guide.md` and `03-model-configuration.md`) where screenshots would provide clarity.

## Detailed Implementation Steps
1. Translate `docs/gitbook/SUMMARY.md` to English, updating it to reflect the 9-chapter structure.
2. Translate `docs/gitbook/01-quick-start.md` to English.
3. Translate `docs/gitbook/02-user-guide.md` to English.
4. Translate `docs/gitbook/03-model-configuration.md` to English.
5. Translate `docs/gitbook/04-core-concepts.md` to English.
6. Rename `docs/gitbook/05-advanced-configuration.md` to `05-advanced-features.md` and translate/update to English.
7. Create `docs/gitbook/06-integrations.md` in English.
8. Rename `docs/gitbook/06-reference.md` to `07-reference.md` and translate/update to English.
9. Create `docs/gitbook/08-known-limitations.md` in English.
10. Rename `docs/gitbook/07-faq.md` to `09-faq.md` and translate/update to English.
11. Launch the dev server via `pnpm --filter @workspace/kg-engine run dev`.
12. Explore the following views in the UI:
    - Dashboard / Projects List
    - Project Creation / Setup
    - LLM Configuration per project
    - Knowledge Graph visualization (L1, L2, L3 nodes)
    - Document uploading / Git parsing initiation
13. Update the newly translated `02-user-guide.md` and other relevant files with step-by-step UI instructions based on the exploration.
14. Add image placeholders corresponding to the UI views in the markdown files.

## Implementation Details
- **Affected Files**:
  - `docs/gitbook/SUMMARY.md`
  - `docs/gitbook/01-quick-start.md`
  - `docs/gitbook/02-user-guide.md`
  - `docs/gitbook/03-model-configuration.md`
  - `docs/gitbook/04-core-concepts.md`
  - `docs/gitbook/05-advanced-features.md`
  - `docs/gitbook/06-integrations.md`
  - `docs/gitbook/07-reference.md`
  - `docs/gitbook/08-known-limitations.md`
  - `docs/gitbook/09-faq.md`
- **Commands to Run**:
  - `pnpm --filter @workspace/kg-engine run dev`
- **Output Artifacts**: Translated Markdown files with enhanced UI documentation and image placeholders.

## Workspaces Affected
- `artifacts/kg-engine` (for running the UI to gather documentation context)
- `docs/gitbook/` (for updating the markdown documentation)
