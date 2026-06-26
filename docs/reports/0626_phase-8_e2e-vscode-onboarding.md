# Verification Report: Item 9.4.3 — E2E: VS Code Extension Onboarding (Playwright)
- **Date**: 2026-06-26
- **Phase & Item**: Phase 8 - E2E VS Code Onboarding
- **Target File**: `artifacts/vscode-client/tests/phase1.spec.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🟡 MEDIUM — Hardcoded Windows path in test helper**: `launch.ts` has `VSCODE_EXE = "D:\\VSCode\\Code.exe"` — tests cannot run on macOS or CI without manual patching.

2. **🟡 MEDIUM — Test selector mismatch**: Tests use `.activitybar .action-item[aria-label="Docuvia"]` but the actual VS Code Electron DOM doesn't match this selector. The extension registers a `viewsContainer` but the aria-label format differs.

3. **🟡 MEDIUM — No Welcome View implementation**: Tests expect a "Welcome View" with class `.view-welcome-content` but no such UI exists in the extension source code.

4. **🟡 MEDIUM — Fixture is minimal**: `empty-workspace` contains only `.vscode/settings.json` with `{}`. No `.git` directory (required by `initProject`), no README/package.json for ecosystem detection.

5. **🟡 MEDIUM — No test runner script**: `package.json` has no `"test"` script for Playwright tests.

6. **🟢 LOW — 12 tests across 3 spec files**: All blocked by the path and selector issues.

### Recommended Fix
1. Replace hardcoded `VSCODE_EXE` with environment variable fallback and platform detection.
2. Update test selectors to match actual VS Code Electron DOM structure.
3. Either implement the Welcome View in the extension or update tests to match actual UI.
4. Add `.git` directory and sample files to test fixtures.
5. Add `"test"` script to `package.json` for Playwright test execution.
