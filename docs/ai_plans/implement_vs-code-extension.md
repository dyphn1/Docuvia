# Docuvia — VS Code Extension Implementation Plan

Version: 2026-05-13

Purpose
-------
This document provides a complete AI implementation plan for a VS Code Extension for the Docuvia project. It is written as a structured, actionable plan intended for handoff to engineering agents. The plan emphasizes an MVP scope (Phase 7: `VS Code extension`) and documents requirements, technical design, API/schema changes, task breakdown, testing, risks, and a Handover Block.

Executive Summary
-----------------
Docuvia's VS Code Extension (MVP) will provide developers with fast contextual search and RAG (retrieval-augmented generation) assistance directly inside the editor, plus the ability to create decision records from selection. The extension will be a workspace package under `extensions/vscode-docuvia/` and will communicate with the existing API server (`artifacts/api-server/`) via new, small REST endpoints (OpenAPI additions). The work is split into OpenAPI design, backend implementation, extension scaffolding & UI (webview), integration testing, CI packaging, and documentation.

Goals & Non-Goals
-----------------
- Goals (MVP):
  - Securely connect VS Code -> Docuvia API server.
  - Provide a "Docuvia Assistant" webview panel for contextual RAG queries based on current file/selection.
  - Provide a searchable command `Docuvia: Search Repository Knowledge` that returns ranked results with source links and opens files in the workspace.
  - Allow creating L3 decision records from selected text and metadata.
  - Basic persistent configuration (API token or base URL) in extension settings.
- Non-Goals (MVP):
  - Full VS Code Language Server Protocol (LSP) integration.
  - Complex realtime collaboration or inline code actions beyond simple suggestions.
  - Marketplace release automation for multiple publishers (optional later).

User Stories & Acceptance Criteria (MVP)
--------------------------------------
1) As a developer, I want to run `Docuvia: Open Assistant` so I can ask questions about the current file or selection.
   - Acceptance: command opens a webview panel, pre-populated with a snippet from current editor buffer (or selection). When sending a query, the panel calls the backend and displays top-K results with source links and confidence/score.

2) As a developer, I want to search the KG for a term or symbol using `Docuvia: Search Repository Knowledge`.
   - Acceptance: command opens an input box, shows a quick pick list of results with file paths and snippet previews; selecting a result opens the file at the source location.

3) As a developer, I want to create a decision record from a selection (`Docuvia: Create Decision Record`).
   - Acceptance: command opens a small form (webview or quick input) capturing title/tags and content, sends it to the API, and returns a created record ID and link.

4) As a user, I want to configure connection settings (server base URL, API token) in VS Code Settings.
   - Acceptance: extension settings persist, token is stored securely using `globalState` or VS Code SecretStorage API, and used for subsequent requests.

5) As a developer, I want the extension to work gracefully when the API server is unavailable.
   - Acceptance: extension shows meaningful errors and allows offline operations (search disabled, but local cache optional).

Priority Features (MVP order)
-----------------------------
1. Authentication & secure API connection (settings + token management)
2. RAG Assistant webview (contextual queries)
3. Quick search command + open file from results
4. Create Decision Record command
5. Basic telemetry/logging only (for debugging) — opt-in

Technical Design
----------------
Architecture Overview
- VS Code Extension (hosted in extension host) implements commands, tree views, and a webview panel.
- Webview UI (React or minimal HTML/JS) provides the chat-like RAG assistant UI; built independently and bundled into the extension.
- Extension communicates over HTTPS to Docuvia API server endpoints (new, small REST endpoints added to the API).
- Authentication: API token or short-lived JWT. Use VS Code SecretStorage (preferred) to store tokens.

Extension Layout (recommended)
- Add new workspace package: `extensions/vscode-docuvia/`
  - `extensions/vscode-docuvia/package.json`
  - `extensions/vscode-docuvia/tsconfig.json`
  - `extensions/vscode-docuvia/src/extension.ts` (entry)
  - `extensions/vscode-docuvia/src/commands/search.ts`
  - `extensions/vscode-docuvia/src/commands/createDecision.ts`
  - `extensions/vscode-docuvia/src/panels/ragPanel.ts`
  - `extensions/vscode-docuvia/src/webview/` (source)
  - `extensions/vscode-docuvia/webview/dist/` (bundled assets)
  - `extensions/vscode-docuvia/README.md`

Build & Tooling Recommendations
- Use `pnpm` workspace membership — add `extensions/*` to `pnpm-workspace.yaml`.
- Tooling:
  - bundler for extension host code: `tsup` or `esbuild` (fast, ESM support)
  - webview UI bundler: `vite` (React) or `esbuild` for simple pages
  - packaging: `vsce` or `@vscode/vsce` for `.vsix` creation
  - test harness: `@vscode/test-electron` for integration tests
- Suggested devDependencies (extension package):
  - `vscode` (dev), `@types/vscode` (dev)
  - `tsup` or `esbuild`
  - `vite`, `react`, `react-dom`, `@vitejs/plugin-react` (if using React webview)
  - `node-fetch` or use global `fetch` available on Node >=18
  - `dotenv` (dev)

Recommended Scripts (add to `extensions/vscode-docuvia/package.json`)
- `dev:webview` — run Vite dev server for local webview iteration
- `build:webview` — build webview assets into `webview/dist`
- `build` — bundle extension host code and copy webview/dist
- `watch` — watch & rebuild extension during development
- `package` — produce `.vsix` via `vsce`

Backend API (OpenAPI) Additions (recommended)
------------------------------------------------
Add a small set of REST endpoints to the API server for extension usage. These should be added to `lib/api-spec/openapi.yaml` and implemented in `artifacts/api-server/`.

Suggested endpoints (MVP):
1. POST `/v1/extensions/vscode/query`
   - Purpose: server-side RAG query. Accepts { "query": string, "context": string?, "top_k": number? }
   - Response: { results: [{ source: string, path: string, excerpt: string, score: number }], meta: { elapsed_ms } }

2. POST `/v1/extensions/vscode/create-decision`
   - Purpose: create an L3 decision record from extension input. Accepts { "title": string, "content": string, "tags": string[]?, "source_refs": [{path, offset?}] }
   - Response: { id: string, url: string }

3. GET `/v1/extensions/vscode/file-context`
   - Purpose: return precomputed relevant contexts for a repo file (optional, performance optimization)
   - Query params: `path` (repo path), `max_tokens`.

4. POST `/v1/extensions/auth/token` (optional)
   - Purpose: exchange short-lived code or API key for a session token (if using session flows)

Security & Auth
- Use `Authorization: Bearer <token>` header.
- Server must validate tokens and enforce rate limits.
- Document scopes required for extension actions (read/search, create-record).

OpenAPI & DB Schema Impact
---------------------------
- OpenAPI: Add the endpoints above to `lib/api-spec/openapi.yaml`. Update Orval codegen configuration if the extension will consume typed clients.
- Database: MVP may not require schema changes if existing L3 record model supports creation. If no existing record table exists, add a `decision_records` table and a migration under `lib/db/src/schema/`.
- Optional DB additions:
  - `extension_events` (for optional telemetry) — schema: id, user_id, event_type, payload JSON, created_at.
  - `user_tokens` or reuse existing `users` table for storing token metadata (but prefer not storing raw tokens; use secure token storage server-side).

Agent Responsibilities (high-level)
----------------------------------
- API Architect: design OpenAPI contract changes, sample requests/responses, API auth model.
- Backend Developer: implement endpoints in `artifacts/api-server/`, add integration tests, and implement migrations if DB changes required.
- Database Schema Expert: design and provide Drizzle/SQL migrations for any new tables (e.g., `decision_records` or `extension_events`).
- Frontend Developer: scaffold extension, webview UI, commands, bundling, integration with API and extension settings.

Implementation Plan — Task Breakdown
-----------------------------------
Each task below lists: Responsible Agent, Input files/paths, Expected outputs, Acceptance criteria, Estimated hours (rough).

1) Task: API Contract Design (OpenAPI)
   - Agent: API Architect
   - Inputs: `lib/api-spec/openapi.yaml`, `docs/roadmap-checklist.md`, `artifacts/api-server/src/`
   - Outputs: updated `lib/api-spec/openapi.yaml` with `/v1/extensions/vscode/*` endpoints, example payloads, and security definitions.
   - Acceptance: OpenAPI passes schema validation; Orval config can generate clients; team signoff.
   - Estimate: 6–10 hours

2) Task: Backend Endpoint Implementation (MVP)
   - Agent: Backend Developer
   - Inputs: updated `lib/api-spec/openapi.yaml`, `artifacts/api-server/src/`, service modules (`embedding.ts`, `document-parser.ts`)
   - Outputs: route handlers, unit/integration tests, documentation snippet in `artifacts/api-server/README.md`.
   - Acceptance: Endpoints respond with correct shape; tests pass locally; endpoints secured via token check.
   - Estimate: 16–24 hours

3) Task: DB Schema & Migrations (if required)
   - Agent: Database Schema Expert
   - Inputs: `lib/db/src/schema/`, `artifacts/api-server/` models
   - Outputs: Drizzle migrations or SQL files; updated schema exports; migration test instructions.
   - Acceptance: Migration applies locally and DB queries work; no breaking existing models.
   - Estimate: 6–12 hours (only if required)

4) Task: Extension Scaffolding & Build Setup
   - Agent: Frontend Developer
   - Inputs: repo root, `pnpm-workspace.yaml`, `package.json`, `artifacts/kg-engine` (for UI patterns)
   - Outputs: `extensions/vscode-docuvia/` scaffold, `package.json` scripts, `tsconfig.json`, bundler config (`tsup` + `vite`), initial `extension.ts` with commands registered.
   - Acceptance: `pnpm --filter @workspace/vscode-docuvia run build` completes; extension loads in VS Code dev host (`F5`).
   - Estimate: 12–20 hours

5) Task: Webview RAG Assistant UI
   - Agent: Frontend Developer
   - Inputs: UI mocks (if any), `artifacts/kg-engine/src/` patterns, extension scaffold
   - Outputs: webview source, build pipeline, React components or minimal UI, call glue to `/v1/extensions/vscode/query`.
   - Acceptance: Webview can send a query and render results with clickable source links; respects settings and token.
   - Estimate: 18–30 hours

6) Task: Commands & Create Decision Record Flow
   - Agent: Frontend Developer + Backend Developer (for API)
   - Inputs: extension scaffold, backend endpoint `/v1/extensions/vscode/create-decision`
   - Outputs: `createDecision` command implementation, form UI, server handler
   - Acceptance: User can create a decision record and receive back an ID/URL; record visible in server DB/UI.
   - Estimate: 8–12 hours

7) Task: Local & Integration Testing (E2E)
   - Agent: Backend Developer + Frontend Developer
   - Inputs: `@vscode/test-electron` harness, API dev server, extension package
   - Outputs: integration tests that boot a test instance of VS Code, simulate commands, and assert responses.
   - Acceptance: CI-style E2E tests run locally and pass on main branch.
   - Estimate: 12–18 hours

8) Task: CI, Packaging, Release Prep
   - Agent: Backend Developer
   - Inputs: monorepo CI config, `extensions/vscode-docuvia/package.json`
   - Outputs: CI job to build extension, produce `.vsix`, basic publish job (manual trigger), updated `pnpm` scripts.
   - Acceptance: `.vsix` can be produced in CI and installed in VS Code; packaging step documented.
   - Estimate: 6–10 hours

9) Task: Documentation & Developer Onboarding
   - Agent: Frontend Developer
   - Inputs: all code changes, README template
   - Outputs: `extensions/vscode-docuvia/README.md` with local testing steps, dev scripts.
   - Acceptance: New developer can run extension in dev host using documented steps.
   - Estimate: 2–4 hours

Estimated Total (MVP): 88–140 hours (team-of-record estimates). Plan workload and sprint slices accordingly.

Testing & Verification
----------------------
Local manual test flow (developer):
1. Start API server (dev): `pnpm --filter @workspace/api-server run dev` (or `pnpm --filter @workspace/api-server run start` per repo scripts).
2. Build webview and extension:
   - `pnpm --filter @workspace/vscode-docuvia run build:webview`
   - `pnpm --filter @workspace/vscode-docuvia run build`
3. Launch VS Code dev host (from the extension project) with `F5` or via CLI:
   - `code --extensionDevelopmentPath=extensions/vscode-docuvia`
4. Test commands: run `Docuvia: Open Assistant`, try queries, and create a decision record.

Integration & E2E tests (automation):
- Use `@vscode/test-electron` to programmatically launch VS Code and run test scenarios (open file, call command, assert webview response).
- Integration tests should spin up a test API server (fixture) or use a mocked backend for deterministic assertions.

Build Verification
- Ensure monorepo `pnpm run build` still succeeds after adding extension workspace entry.
- Add CI job to run `pnpm --filter @workspace/vscode-docuvia run build` and run the integration test suite.

Security & Privacy Considerations
--------------------------------
- All requests from extension must go through HTTPS; require auth tokens.
- Provide explicit opt-in setting for telemetry or event reporting.
- Provide documentation about what code/text is sent to the server. Default to send minimal context (selection or sampled context) and allow user control.

Risks, Dependencies, & Mitigation
---------------------------------
- Risk: API server changes required and not yet available.
  - Mitigation: start with a small, well-defined OpenAPI surface; use feature flags; provide clear mocks for front-end work.
- Risk: Sending source code to remote service creates privacy concerns.
  - Mitigation: document behavior, provide local-only mode, allow opt-out, and minimize sent context.
- Risk: Webview bundling complexity (React + monorepo).
  - Mitigation: use Vite + a simple bundling pipeline; keep webview UI minimal for MVP.
- Risk: Publishing to Marketplace requires review and potential permission changes.
  - Mitigation: keep requested permissions minimal; use `storage`, `secretStorage`, and `workspace` scopes only as required.

Fallback Plan
-------------
- If backend endpoints cannot be implemented before release, ship a local-only extension that points to the existing Docuvia web UI (open in browser) and provides a search shortcut that opens the web client with prefilled query.
- Implement feature toggles in the extension so that individual features can be turned off remotely or via settings.

Future Enhancements (post-MVP)
------------------------------
- Inline code actions & quick fixes backed by KG.
- LSP integration for richer in-editor hints.
- Workspace-wide indexing & local caching to allow offline queries.
- Publish to VS Code Marketplace, teams-managed deployment and telemetry dashboards.

Files / Paths to Create (summary)
---------------------------------
- `extensions/vscode-docuvia/` (entire extension package)
- `lib/api-spec/openapi.yaml` (add extension endpoints)
- `artifacts/api-server/src/routes/extensions/vscode/*.ts` (implement handlers)
- `lib/db/src/migrations/*` (if new tables required)

Notes about repo constraints
---------------------------
- Repo uses pnpm, ESM and Orval for API codegen. Any OpenAPI additions must be reconciled with Orval config in `lib/api-spec/orval.config.ts` so client generation remains correct.
- The extension itself will be a separate workspace package; ensure `pnpm-workspace.yaml` includes `extensions/*`.

### 🤝 Handover Block
- recommended_agent: API Architect
- dispatch_prompt: Please review the Docuvia VS Code extension plan at `docs/ai_plans/implement_vs-code-extension.md`, design the OpenAPI additions for `/v1/extensions/vscode/*` (query, create-decision, file-context, auth), include schemas and example payloads, and propose security scopes. Deliver an updated `lib/api-spec/openapi.yaml` and sample curl requests.
- ai_plan_path: docs/ai_plans/implement_vs-code-extension.md
- files_to_pass: [
  lib/api-spec/openapi.yaml,
  artifacts/api-server/src/, 
  lib/db/src/schema/, 
  docs/roadmap-checklist.md,
  package.json,
  pnpm-workspace.yaml,
  docs/ai_plans/implement_vs-code-extension.md
]
- acceptance_checks: [
  "OpenAPI additions exist and validate against the OpenAPI spec (no schema errors)",
  "Example request/response payloads provided for each endpoint, including error cases",
  "Security scopes and header/auth model documented for extension consumption"
]
- estimated_total_hours: 100

End of document.
