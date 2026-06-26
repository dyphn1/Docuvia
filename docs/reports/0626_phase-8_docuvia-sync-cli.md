# Verification Report: Item 3.4.3 — docuvia sync Bidirectional CLI
- **Date**: 2026-06-26
- **Phase & Item**: Phase 8 - docuvia sync CLI
- **Target File**: `scripts/src/cli.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🟡 MEDIUM — CLI calls wrong endpoint**: The `sync` subcommand in `cli.ts` calls `POST /projects/:id/sync` (a stub endpoint) instead of `POST /sync/push` (the actual CQRS outbox receiver implemented in `sync.ts`).

2. **🟡 MEDIUM — Git hook incompatible**: The git hook template (`githook-template.sh`) invokes `docuvia sync` but the CLI's sync logic doesn't match the expected githook interface (post-commit hook receiving commit SHA via stdin).

3. **🟡 MEDIUM — No `bin` entry in package.json**: `scripts/package.json` has no `bin` field, so `docuvia` CLI cannot be installed globally or via `npx`.

4. **🟡 MEDIUM — No test coverage for sync CLI**: No tests verify the sync flow (outbox flush, push to server, ACK handling).

5. **🟢 LOW — `POST /projects/:id/sync` is a stub**: The endpoint exists in `projects.ts` but has no implementation beyond a placeholder response.

### Recommended Fix
1. Update CLI to call `POST /sync/push` instead of `POST /projects/:id/sync`.
2. Align git hook template with CLI interface (pass commit SHA as argument or stdin).
3. Add `bin` entry to `scripts/package.json`.
4. Implement the `POST /projects/:id/sync` stub or remove it.
5. Add integration tests for the sync CLI flow.
