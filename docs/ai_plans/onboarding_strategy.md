# Onboarding Strategy & Quick Start

## Implementation Goals
- Create a frictionless first-run experience that introduces users to Docuvia's core features without overwhelming them.
- Streamline configuration for server URLs and credentials so users don't need to manually edit config files.
- Drive user engagement through an intuitive walkthrough that guides them from zero configuration to their first query.

## Approach / Methodology
- **VS Code Walkthrough**: Leverage VS Code's native Walkthrough contribution (`contributes.walkthroughs` in `package.json`).
- **4-Step Onboarding Flow**:
  1. **Connect & Authenticate**: Explain the `docuvia.setServerToken` command and prompt the user to input their central server credentials. Include a visual indicator in the primary view if the connection is missing.
  2. **Explore Workspace**: Introduce `@docuvia /explore` to generate the initial `l1_tags.yaml`.
  3. **Extract Knowledge**: Guide the user to run `@docuvia /extract` on a single file or small folder to see L3 generation in action.
  4. **Query & Leverage**: Show how to use `@docuvia /query` or the Chat view to retrieve the ingested knowledge.
- **Dashboard Panel Enhancement**: When the `DashboardPanel.ts` is opened without a configured server, display a "Get Started" state rather than a generic error.

## Detailed Implementation Steps
1. Add `contributes.walkthroughs` to `package.json`.
2. Create SVG or Markdown assets for the walkthrough steps in a new `resources/walkthrough/` folder.
3. Update `src/extension.ts` to show the walkthrough on the first activation (using VS Code `globalState` to track if it has been shown).
4. Modify `DashboardPanel.ts` to include an "Onboarding Mode" that clearly surfaces the "Set Server Token" button if `KnowledgeStore` reports an unconfigured client.
5. Create an `onboarding.md` design doc in `artifacts/vscode-client/design/ui-ux/`.

## Implementation Details
- **Affected Workspace**: `artifacts/vscode-client/`
- **Files**:
  - `package.json`
  - `src/extension.ts`
  - `src/DashboardPanel.ts`
  - `resources/walkthrough/*` (new assets)
  - `design/ui-ux/onboarding.md` (new design doc)

## Verifiable Success Criterion
On a pristine installation (simulated by clearing global state), opening the extension automatically displays the Docuvia VS Code Walkthrough. The walkthrough contains actionable buttons that execute configuration commands successfully.
