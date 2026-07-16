# Phase 1 Execution Strategy & Status Alignment (2026-07-16)

> **Context:** This report provides an analysis of the codebase state against the Phase 0-1 roadmaps, the gap analysis, and ADR PLAT-007, offering a concrete execution plan.

## 1. Status Alignment

### Phase 0: Background Readiness & Core Fixes

- **Major Concurrency Bugs & CLI Build Issues Resolved**:
  - The `tsup.config.ts` double shebang issue preventing `dist/cli.js` from booting has been fixed.
  - The AST worker's `encoding.js` module resolution crash loop during `init` is resolved.
  - **Verified**: Running `docuvia status` successfully parses and reports L2 Nodes (e.g., 2852 nodes).
- **Remaining Debt**: Minor edge cases (Windows `EBUSY`, interactive `query` TTY, etc.) remain as documented in `cli-test-analysis/README.md` but do not block core workflows.

### Phase 1: Tiered Background Evolution (PLAT-007)

The architecture is currently in a "wires broken" state—the components exist but are not connected:

- **Wire 2 (L3 Persistence)**: **Unimplemented.** `l3_nodes` schema and repo exist, but `analyze <targetPath>` only prints results. The `sync` command has nothing to push.
- **Tier A (AST Delta Update / Wire 1)**: **Unimplemented.** `SemanticDiffDetector` exists (as dead code). `analyze` lacks the auto-incremental mode, and the post-commit hook still points to the static `snapshot` command.
- **Reliability (Tier B/C, Doctor)**: Batch LSP, LLM queues, and `doctor` LLM health checks are pending.

---

## 2. Strategic Recommendations & Execution Order

With the AST crash loop and CLI build issues out of the way, the project is perfectly positioned to execute PLAT-007. The recommended implementation order is:

### 🥇 Priority 1: Connect Wire 2 (L3 Decision Persistence)

- **Action**: Modify `analyze-workflow.ts` to write LLM extraction results to the `l3_nodes` table using the existing repo.
- **Provenance data required**: target file, `commitSha`, model used, content hash, and validity status.
- **Why**: Smallest scope, completely independent, and immediately unblocks the `sync` push pipeline.

### 🥈 Priority 2: Fix `init` Automation (CI / Headless Support)

- **Action**: Add a `--yes` or `--non-interactive` flag to the `init` command in `artifacts/cli/src/commands/init.ts`.
- **Why**: Prevents the command from hanging on TTY confirmation prompts (`askConfirm`), unlocking automated E2E testing and smoother CI pipelines.

### 🥉 Priority 3: Implement Tier A (AST Delta Updates) & Switch Hook

- **Action**:
  1. Expand the `analyze` command to support **Auto Mode** (reading `Docuvia-Source` SHA).
  2. Wire up `SemanticDiffDetector` to filter changed files and pass them to `AstProcessingService`.
  3. Complete the required concurrency tests (`hydrate` and `snapshot`) listed in `cli-test-analysis`.
  4. Update the post-commit hook to run `docuvia analyze` instead of `docuvia snapshot`.

### 🏅 Priority 4: Enhance `doctor` Reliability Checks

- **Action**: Add checks in the `doctor` workflow for:
  1. Post-commit hook presence vs. `docuvia` binary resolvability (preventing silent failures).
  2. LLM endpoint connectivity (Local/Remote) via the LLM-002 CLIProxyAPI bridge.

---

## 3. Conclusion

The codebase is in an excellent starting position. Blocking bugs have been eliminated, and the architectural blueprint (PLAT-007) is clear. Beginning with **L3 Persistence** provides immediate value and closes a long-standing gap in the knowledge loop.
