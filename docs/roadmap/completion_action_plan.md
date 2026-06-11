# Docuvia Roadmap Completion: 4-Phase Detailed Action Plan

> This document dictates the exact technical implementation requirements for all remaining `❌ FAIL`, `❌ Todo`, and `⚠️ WIP` items. It has been stress-tested via dialectical contradiction (反證法) to ensure edge cases, concurrency limits, and performance bottlenecks are addressed *before* coding begins.

---

## Phase 1: Stabilization & Concurrency (The Foundation)
**Goal:** Prevent data corruption, handle timeout limits, and achieve sub-second local sync.

### [BE] Item 1.4.2: Mutex for Concurrent Generate Requests
*   **The Trap:** Long-running LLM tasks holding DB connection locks (`pg_advisory_xact_lock`) will exhaust connection pools and cause deadlocks.
*   **The Implementation:** 
    *   Use **Optimistic Concurrency Control (OCC)**.
    *   Update via CAS: `UPDATE projects SET status = 'indexing' WHERE id = ? AND status IN ('active', 'error')`.
    *   Check `rowCount`: If `0`, immediately return HTTP 409 Conflict (Another generate is in progress).
    *   Ensure a `finally` block or metabolism background job exists to reset `status = 'error'` if the Node process crashes mid-generation.

### [FE/SA] Item 3.4.4: VS Code KnowledgeStore Rewrite
*   **The Trap:** Spawning `git show` sequentially for 1,000+ nodes blocks the extension host, freezing VS Code.
*   **The Implementation:**
    *   Retrieve all paths using `git ls-tree -r docuvia-knowledge:`.
    *   Pass the paths to `git cat-file --batch` via `stdin` using a single persistent `child_process.spawn`.
    *   Stream and parse the output asynchronously so the main VS Code UI thread is never blocked.

### [BE] Item 3.5.1 & 3.5.2: Diff Projection & Ancestor Anchoring
*   **The Trap:** Squashed commits, detached HEADs, or force-pushes will cause `git merge-base` to fail or return empty.
*   **The Implementation:**
    *   Execute `git merge-base HEAD origin/main`.
    *   **Fallback:** If exit code > 0 (no common ancestor), fallback to full repository analysis (treat diff against empty tree).
    *   Project knowledge deltas by calculating the diff only from the merge-base, ensuring we don't re-ingest the entire history on every feature branch.

---

## Phase 2: Core Logic — L2 Bootstrap & Merge Gate
**Goal:** Deterministic parsing and un-droppable workflow state.

### [FE] Item 4.2.3: L2 Module Confirmation UI
*   **The Trap:** Displaying 50+ AI-generated modules in a flat list causes PM cognitive overload.
*   **The Implementation:**
    *   Create a specialized view in `kg-engine` that groups discovered L2 modules under their parent `L1 Tags`.
    *   Show a clear "Diff View" indicating which modules are *New* vs *Existing*.
    *   Provide "Bulk Approve" and inline edit actions.

### [BE] Item 4.2.4 & 4.2.5: Deterministic Glob Path Assignment
*   **The Trap:** Ambiguous or overlapping globs (`src/**/*.ts` vs `src/api/**/*.ts`) cause random commit assignments.
*   **The Implementation:**
    *   Implement a **Glob Specificity Algorithm**: Score rules by the depth of static path segments (e.g., `src/api/` wins over `src/`).
    *   When saving to `.docuvia/config.yaml`, pre-sort the path array by this specificity score descending.
    *   During ingestion, the first matching pattern in the array wins, guaranteeing O(1) determinism.

### [BE] Item 4.3.2 & 4.3.8: Phase 2 Merge Gate
*   **The Trap:** Webhooks frequently drop. Relying entirely on Push payloads leaves nodes permanently in `pending`.
*   **The Implementation:**
    *   **Primary:** `github_webhooks.ts` catches `pull_request.closed` (merged=true) and promotes L3 nodes to `valid`.
    *   **Fallback:** Add a daily task to `metabolism.ts` (cron) that queries DB for `L3 nodes WHERE validityStatus = 'pending' AND createdAt < NOW() - 24h`, then checks the Git/GitHub API to see if the source commit is now in the default branch.

---

## Phase 3: QA & Automated Testing (Defensive Engineering)
**Goal:** Flake-free CI and realistic AI mocking.

### [QA/FE] Item 9.4.3: VS Code E2E Tests
*   **The Trap:** E2E runs without the Express backend, causing Immediate failures. Asynchronous indexers cause flaky timeouts.
*   **The Implementation:**
    *   Inject `DOCUVIA_MOCK_SERVER=1` in the `@vscode/test-electron` test suite.
    *   Implement an interceptor in `CentralServerClient.ts` to return static JSON fixtures when the flag is true.
    *   Expose a test-only event `docuvia.onDidFinishIndexing` to allow Playwright/Mocha to explicitly `await` before asserting UI state.

### [QA/BE] Item 9.4.4: LLM Pipeline E2E
*   **The Trap:** Simple JSON mocks don't test the regex cleanup logic. Real APIs return Markdown blocks or extra text.
*   **The Implementation:**
    *   Use MSW (Mock Service Worker) to intercept `api.openai.com`.
    *   Return **Fuzzing Payloads**: e.g., ```json\n[{...}]\n``` with surrounding text, testing if `generate.ts` regex `/\[[\s\S]*\]/` actually extracts the payload correctly.

---

## Phase 4: Operations & Distribution
**Goal:** Lean architecture and zero-bloat packages.

### [SA] Item 10.2.3 & 10.2.4: Docker & Static Serving
*   **The Trap:** Serving `kg-engine/dist` via Node.js Express blocks the Event Loop during heavy Git log processing, killing UI responsiveness.
*   **The Implementation:**
    *   Use a **Multi-stage Dockerfile**.
    *   Stage 1: Build Frontend and Backend.
    *   Stage 2 (Runtime): Run `nginx` on Port 80 for static files (`kg-engine/dist`), and proxy `/api/*` to the Node.js Express service running on Port 8080.

### [FE] Item 10.1.4 & 10.3.1: VSIX Packaging
*   **The Trap:** Running `vsce package` bundles all 300MB of `node_modules` dependencies.
*   **The Implementation:**
    *   Integrate `esbuild` into the VS Code extension build script (`artifacts/vscode-client/package.json`).
    *   Bundle everything into a single `dist/extension.js`.
    *   Add a strict `.vscodeignore` to exclude the raw `node_modules` and source files.
    *   Ensure the CI Action uploads the resulting `< 2MB` `.vsix` file.
