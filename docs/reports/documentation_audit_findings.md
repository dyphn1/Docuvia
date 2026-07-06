# Documentation Audit Findings

**Date**: 2026-07-06

This document lists structural ambiguities, inconsistencies, and conflicting information found across the repository's documentation and source code.

## 1. Structural / Directory Path Inconsistencies

- **`docs/reports/` vs `docs/reports/` Misalignment**:
  - The deprecated `docs/gitbook/roadmap/roadmap-checklist.md` (now `docs/gitbook/roadmap/README.md`) instructs agents to save verification reports to `docs/reports/MMDD_phase-X_feature-name.md`.
  - `docs/gitbook/roadmap/ast-parser-roadmap.md` instructs agents to read `docs/reports/.ast-verification-index.json`.
  - **The Conflict**: The actual reports directory is located at `docs/reports/`. This causes automated agents to either fail to find the index or create duplicated root-level folder structures during workflow executions.
- **Orphaned Report Files**: The `docs/reports/` directory contains files (`consolidated_status_report.md`, `gitbook-audit-2026-07-05-outstanding.md`, `vscode-client-refactoring.md`) that are not linked anywhere in the main `SUMMARY.md` navigation tree, making them invisible in GitBook.

## 2. Conflicting Technical Information

- **Ollama Support Contradiction**:
  - Both `AGENTS.md` and `CLAUDE.md` explicitly state: `No native Ollama support — use an OpenAI-compatible proxy (LiteLLM, etc.).`
  - **The Conflict**: The source code in `lib/integrations-openai-ai-server/src/client.ts` implements explicit native support for Ollama: `if (provider === "ollama" || provider === "local") { baseURL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1"; apiKey = "ollama"; }`.

## 3. Code vs Test Documentation Drift

- **Ignored `cli` Tests**:
  - `AGENTS.md` states: `pnpm test only runs api-server tests (kg-engine has no test script).`
  - **The Conflict**: While `kg-engine` indeed has no tests, the root `package.json` (`"test": "node scripts/ensure-db.mjs && pnpm --filter @workspace/api-server run test"`) completely ignores the `@workspace/cli` tests. The documentation and root test scripts need to be updated to reflect that the `cli` package is now testable.

## 4. Content Placeholders (Empty / WIP Files)

Several key documentation pages referenced in the `SUMMARY.md` exist only as stubs with a `> **Work in progress.**` quote block and no actual content:

- `docs/gitbook/getting-started/installation.md`
- `docs/gitbook/getting-started/quick-start.md`
- `docs/gitbook/user-guide/configuration.md`
- `docs/gitbook/user-guide/vscode-client.md`
