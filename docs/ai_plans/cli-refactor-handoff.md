# CLI Refactor & InitService Handoff

## Current Progress
We have successfully completed a major refactoring of the `@workspace/cli` to align with **ADR-021** (Shared Core DI) and **ADR-034** (Wizard-Style Interactive CLI).
All "hallucinated progress" and hardcoded dependencies have been stripped away:

1. **DI Container Unified**: The `Container` implementation was extracted from `api-server` to `@workspace/core` (`lib/core/src/di/container.ts`). All CLI commands now use `container.resolve()` instead of directly instantiating classes (`new Service()`).
2. **String/Schema Extraction**: 
   - UI strings moved to `constants/ui-messages.ts`.
   - Hardcoded database schemas moved to `lib/core/src/constants/schema.sql`.
   - Command definitions consolidated in `lib/core/src/constants/cli-commands.ts`.
3. **Platform Hook Refactoring**: The `init` command's Agent Hook installation logic was refactored into the Strategy/Platform pattern (`CursorPlatform`, `ClaudePlatform`, `GenericMarkdownPlatform`), allowing users to interactively choose which agent integrations to install.
4. **Defect Extermination**: 
   - Removed the nonexistent `docuvia sync --local` arguments from docs and git hooks.
   - Updated the Git hook to point to `docuvia snapshot`.

## Pending Critical Task: `InitService` Rewrite (ADR-001)

The underlying `InitService` (`lib/core/src/services/init-service.ts`) currently remains an empty shell (Compliance Theater). It creates tables and sets up temp files, but returns without performing the core initialization logic dictated by **ADR-001 (Zero to One)**.

### Next Steps for `InitService`

When resuming work, the AI Agent MUST implement the following steps within `InitService.init()`:

1. **Deterministic Recon**: Integrate with `FileDiscoveryService` to scan the workspace (respecting `.gitignore`) and sample the directory structure.
2. **Feature Sniffing / Heuristics**: Analyze file extensions (e.g., `.ts`, `.tsx`, `.rs`, `.py`) to deduce the primary domains of the project.
3. **L1 Tag Proposal**: 
   - Propose generic L1 tags based on heuristics (e.g., if `.tsx` is found, propose "Frontend").
   - *(Optional AI Expansion)* If configured, send a shallow directory snapshot to the LLM (`integrations-openai-ai-server`) to suggest more contextual L1 tags.
4. **Cognitive Snapshot**: Write the discovered project context and proposed tags into the newly created `.docuvia/local.db` tables (`projects`, `l1_tags`).

### Pending Task: Update CLI Unit & Integration Tests

The massive refactoring of `artifacts/cli` successfully purged hardcoded schemas and forced the adoption of the Dependency Injection Container (`setupDI`) from `@workspace/core`.
However, because all CLI `commands/*.ts` now use `container.resolve<Service>(...)` instead of `new Service()`, several **existing unit tests and integration tests are currently failing**.

**The failures happen because:**
1. The `container` object from `@workspace/core` is not properly mocked or populated in test setup files (like `query.unit.test.ts` or `status.unit.test.ts`), throwing `[vitest] No "container" export is defined`.
2. The UI messages were extracted to `UI_MESSAGES` in `constants/ui-messages.ts`, so test assertions checking for exact terminal output (like `expect(stdout).toContain("...")`) need to be updated to match the new dynamic templates.

**Next AI Agent Steps:**
- Update `test/unit/commands/*.unit.test.ts` to properly mock the `@workspace/core` container.
- Update `test/integration/*.test.ts` to match the new output strings defined in `artifacts/cli/src/constants/ui-messages.ts`.
- Ensure `pnpm --filter @workspace/cli test` runs completely green before proceeding to the `InitService` deep-dive.
