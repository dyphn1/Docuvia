# Docuvia UI Testing Strategy (Playwright)

## Overview

To ensure the VS Code extension behaves correctly from a user's perspective, we employ **End-to-End (E2E) UI Testing using Playwright**. This approach connects directly to the VS Code Electron instance, allowing us to simulate actual user interactions (clicking buttons, typing commands, viewing Webviews) and verify the results against the DOM.

This document outlines the testing strategy, categorized by our Roadmap Phases, highlighting the common "AI Hallucination" pitfalls that these UI tests are designed to catch.

## Why Playwright over Unit Tests?

AI coding agents often generate perfectly compiling logic that fails in the real UI due to:
- Missing Context Keys (`setContext` not called) causing views not to show.
- DOM changes or CSP blocking in Webviews.
- Unhandled Promises or silent failures in Command executions.

Playwright tests act as an objective judge. An AI task is not considered complete until the Playwright UI test passes.

---

## Phase 1: Local Knowledge Schema & Foundations

**Goal:** Verify the extension initializes the local `.docuvia` workspace correctly via commands.

**Potential Issues Caught by UI Tests:**
1. **Command Execution Failure:** The command `Docuvia: Init Project` might fail silently due to missing dependencies, unhandled exceptions, or incorrect path calculations. Playwright verifies the command actually results in observable UI changes.
2. **Welcome View State Bug:** When `.docuvia` is created, the "Welcome to Docuvia" view in the Activity Bar should disappear, and the TreeView should render. AI often forgets to update the `docuvia:isInitialized` context key.
3. **Prompt Handling:** Ensure QuickInput widgets (like asking for a project name) actually appear and can accept input without hanging the extension host.

**Test Approach:**
- Launch VS Code with an empty workspace.
- Open Command Palette -> type `Docuvia: Init Project`.
- Verify the Welcome View disappears.
- Verify the `.docuvia` folder exists on the file system.

---

## Phase 2: UI/UX Shell & TreeViews

**Goal:** Verify TreeViews and the Dashboard Webview render correctly and are interactive.

**Potential Issues Caught by UI Tests:**
1. **Webview Blank Screens:** Dashboard React/HTML fails to load due to Content Security Policy (CSP) blocking local resources or incorrect URI resolution (`webview.asWebviewUri`).
2. **TreeView Interaction Failure:** Clicking a node in the Knowledge Graph TreeView fails to open the corresponding file or execute the intended action.
3. **Webview to Host Communication:** Clicking a button inside the Dashboard Webview (e.g., "Search") fails to trigger actions in the Extension Host (like opening the Chat Participant).

**Test Approach:**
- Mount the extension and open the Dashboard.
- Locate the Webview iframe and assert critical DOM elements (e.g., `text="Project Knowledge Hub"`).
- Simulate clicking an L1 Tag button inside the Webview and verify the UI updates (e.g., a detail view appears).

---

## Phase 3: Interactive Exploration & Hybrid Execution (Chat)

**Goal:** Verify the `@docuvia` chat participant responds correctly and action buttons work.

**Potential Issues Caught by UI Tests:**
1. **Participant Registration:** The `@docuvia` participant does not appear when typing in the chat input.
2. **Command Argument Parsing:** Typing `/explore frontend` fails to parse the `frontend` argument, resulting in the wrong template or an error.
3. **Command Link Inactivity:** Action buttons rendered in Markdown (e.g., `[Accept L1 Tags](command:...)`) fail to execute because the command isn't registered or arguments aren't URI-encoded properly.

**Test Approach:**
- Simulate typing `@docuvia /explore` in the Chat Panel.
- Assert the response contains expected Markdown.
- Click a generated command link in the chat response and verify the file system changes.

---

## Phase 4: Editor Integration (Deep Context)

**Goal:** Verify CodeLens and context menus appear in the correct places in the code editor.

**Potential Issues Caught by UI Tests:**
1. **CodeLens Misalignment:** CodeLens text (`🧠 Docuvia: 2 Decisions`) appears on the wrong line or fails to appear entirely due to document parsing errors.
2. **Context Menu Scope:** Right-clicking selected text to "Add Decision" fails to capture the highlighted text or line numbers.

**Test Approach:**
- Open a test `.ts` file containing mock functions.
- Wait for the CodeLens provider to run and assert the presence of specific CodeLens text above the target function.
- Select code, simulate a right-click, select the Docuvia command, and verify a new Markdown file opens with the selected code block.

---

## Phase 5: Breadth Search Integration (Central Server)

**Goal:** Verify cross-project search and credential management UI.

**Potential Issues Caught by UI Tests:**
1. **Secret Storage Failure:** Setting an API token via the command palette fails to persist across reloads (issues with `context.secrets`).
2. **Network Error UI:** If the remote server returns a 500 error, the Chat Panel hangs on "Thinking..." instead of showing a graceful error message.

**Test Approach:**
- Run the token command, enter a mock token, restart the test instance, and verify the token is retained.
- Mock network requests to fail, execute a `/query` command, and verify the UI displays a proper error state without crashing.
