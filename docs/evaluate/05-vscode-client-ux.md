# 05. VS Code Client UX

**Severity:** 🟡 MEDIUM
**Affected Docs:** VS Code Client Docs (`user-journeys.md`, `command-palette/*`, `ui-ux/*`)

UX design documents focus too much on idealized states and lack concrete UI references.

## 1. Oversized `user-journeys.md` and Lack of Unhappy Paths
*   **Deficiency:** The document is 55KB and difficult to read. More importantly, all journeys are Happy Paths.
*   **Proposed Fix:**
    *   Split the document into multiple smaller files based on Persona or Context.
    *   Add Unhappy Paths: Initialization failures, network disconnections, meaningless LLM responses, and user experience during Git conflicts.

## 2. Missing Webview UI Mockups
*   **Deficiency:** `ui-ux/webview-panels.md` describes rich graph visualization and settings panels entirely in text, without any mockups or visual library selections (e.g., D3.js, React Flow).
*   **Proposed Fix:** Add Wireframes for each Webview and define support for Dark/Light Themes.

## 3. Notification Fatigue
*   **Deficiency:** `ui-ux/notifications-and-prompts.md` defines many notifications that could pop up frequently in active repositories, disrupting development.
*   **Proposed Fix:**
    *   Introduce a "Do Not Disturb" mode.
    *   Integrate non-urgent notifications into the VS Code Notification Center instead of active Toast popups.

## 4. Unclear Monorepo Support
*   **Deficiency:** `command-palette/init-project.md` assumes each Workspace has only one Git Root. There is no support strategy for enterprise Monorepo architectures.
*   **Proposed Fix:** Add initialization strategies tailored for multi-root workspaces and monorepos.