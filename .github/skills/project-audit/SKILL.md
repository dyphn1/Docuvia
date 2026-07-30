# Docuvia Comprehensive Project Audit Workflow

You are the Master Orchestrator. When executing this skill, you MUST perform a comprehensive 4-round verification of the `Docuvia` project. You must dispatch tasks to the correct team members (subagents) for each round.

## Core Principles

- **No Shortcuts**: Every round must be strictly executed and documented.
- **Anti-Fake Policy**: Adhere strictly to the "NO FAKE IMPLEMENTATIONS" rule. No stubs, mocks, or hardcoded returns in production code. Real logic must be implemented.
- **Three-Way Alignment**: Documents, Implementation (API/DB schemas), and Tests must align perfectly.
- **Challenger Mindset**: Actively seek out flaws, omissions, and fake implementations across the full-stack architecture.
- **Subagent File-by-File Verification**: Do not rely solely on high-level `grep`. You MUST dispatch the assigned subagents to deeply read and verify the flagged files ONE BY ONE to ensure thoroughness and accuracy.

## Execution Pipeline

To prevent context window overload, the audit MUST be executed in batches grouped by functional areas.

### Phase 0: Discovery & Categorization

1. **Retrieve File List**: Run `git ls-files` in the terminal to capture all tracked files in the workspace.
2. **Categorize by Functional Area**: Record the files and group them into logical domains (e.g., `CLI commands`, `MCP tools`, `AST/parsing`, `database schema`, `documentation`, `core services`).
3. **Initialize Todo List**: Use the `manage_todo_list` tool to create a strict plan. Each Todo item must represent the full audit of **one specific functional category**.

### Phase 1: Iterative Category Audit

For each functional category in the Todo list, mark it `in-progress` and execute the following 4 verification rounds strictly on the files within that category. Mark as `completed` only when all rounds for that category pass.

#### Round 1: Document & Architecture Alignment

**Agents Assigned:** `requirement-analyzer`, `Explore`
**Audit Actions (HOW TO DO IT):**

1. **ADR Contradiction Sweep**: Use the terminal to list `docs/gitbook/adr/`. Read them to build a timeline. If a newer ADR overrides an older one, it MUST have an explicit `Supersedes: [ADR-Name]` header. Flag any undocumented overrides.
2. **Visual & Architectural Assessment**: Read `.md` files in `docs/gitbook/architecture/` and `docs/gitbook/architecture/`. Identify complex workflows, state transitions, or architecture descriptions. If a section's readability can be significantly improved with a visual diagram, verify there is a ````mermaid` block supplementing it. If missing, flag it for illustration supplement.
3. **Cross-Link Resolution**: Verify that inter-document links (e.g., `[Agent Details](./path)` in `AGENTS.md` or roadmap items) actually resolve to correct and existing files. Flag any broken markdown links, outdated references, or mismatching anchors.
4. **Code Alignment**: If `docs/gitbook/evaluate/` or `docs/gitbook/architecture/` claims a specific module exists (e.g., "intent router"), use `grep` or `Explore` to verify the actual folder/file exists in `artifacts/` or `lib/`. Flag undocumented or missing layers.

### Round 2: Contract Boundary & Database Schema Validation

**Agents Assigned:** `Explore`, `database-schema-expert`
**Audit Actions (HOW TO DO IT):**

1. **Virtual Contracts Enforcement**: Per AGENTS.md's architecture mandate, cross-importing between implementation libraries (`lib/schema`, `lib/ast-core`, `lib/git-local`, etc.) is forbidden — all cross-package calls must go through `lib/contracts` interfaces. Run `grep -rn "from '@workspace/schema'" lib/ast-core/src/ lib/git-local/src/` (and similar pairs) to catch illegal direct imports. Flag any found as Severe.
2. **Schema Integrity**: Read files in `lib/schema/src/sqlite/migrations/`. Verify that knowledge tier tables (`l1_tags`, `l2_nodes`, `l3_nodes`, `node_links`) exist. Verify appropriate `CREATE INDEX` statements exist for frequently-queried columns. Flag missing indexes.
3. **Roadmap Truthfulness Check**: Read `docs/gitbook/evaluate/index.md` and `docs/gitbook/roadmap/`. For every `[x]` (completed item), find the corresponding source file. If the source file contains `TODO`, `stub`, or hardcoded mock returns, flag it as a "False Positive" and instruct the user to downgrade the markdown file to `[ ]`.

### Round 3: Implementation Verification

**Agents Assigned:** `Explore`, `task-verifier`
**Audit Actions (HOW TO DO IT):**

1. **Anti-Fake Sweep**: Run `grep -rnw -iE 'stub|todo|mock|dummy' artifacts/ lib/ --exclude-dir=test --exclude-dir=tests --exclude-dir=generated`. Any matches in production code MUST be flagged as Severe Architecture/Anti-Fake Violations.
2. **Single Responsibility Principle (SRP) & Naming**: Inspect source files and their contents. Verify that file names accurately reflect their responsibilities. Internal functions must do exactly what their names imply without hidden side effects. Flag any file or function violating SRP (e.g., mixing presentation logic with DB queries).
3. **DRY Principle (Don't Repeat Yourself)**: Scan for duplicated logic. If the same logic pattern, data transformation, or error-handling structure is repeated 3 or more times across the codebase, flag it to be refactored into a more concise, shared utility or helper.
4. **Architectural Purity**: Ensure clean separation of concerns per AGENTS.md's Lifecycle mandate — implementations self-register to `docuviaFactory` and are instantiated by the Orchestration layer (`lib/ui-core`), not by each other. Verify `artifacts/cli/src/commands/*.ts` stay thin (call composition-root functions in `lib/core/src/composition/`, not raw services or business logic directly).

### Round 4: Test Quality Validation

**Agents Assigned:** `Explore`, `task-verifier`
**Audit Actions (HOW TO DO IT):**

1. **3A Enforcement**: Find and open 3 random `*.unit.test.ts` files. Verify that the Arrange (setup data), Act (call function), and Assert (verify result) phases are visually or logically separated. Flag messy tests.
2. **Deep Assertion Check**: Run `grep -rn 'toBeDefined()' artifacts/` and `grep -rn 'toBeTruthy()' artifacts/`. Flag assertions that only check existence. Tests MUST verify specific payload structures or DB state changes (using the `withRollback` wrapper).
3. **Sad Path Coverage**: Read test files under `artifacts/cli/test/` and `lib/*/test/`. Verify the presence of error-path assertions (e.g. `DocuviaError` codes like `DB_OPEN_FAILED`, `DB_MIGRATION_FAILED`). Flag if only "Happy Path" scenarios are covered.
4. **Metrics Verification**: Run `pnpm run test` (the workspace `test` script already runs with `--coverage`, per `package.json`) in the terminal. Wait for the output. Flag any core package (`cli`, `core`, `schema`, `ast-core`) that shows less than 80% Statement coverage.

### Phase 2: Final Reporting

After all functional categories in the Todo list are marked `completed`, create a consolidated report file: `docs/reports/audit-report-[DATE].md`.
**Memory Persistence**: You MUST also record the path of this new report and a summary of the pending High (Critical) tasks into `/memories/repo/active_audit.md` (using the memory tool) so the AI context never loses track of the remaining audit debt.

**Formatting Rules:**

- The report MUST be formatted as a **Prioritized Task List** (checkboxes `[ ]`).
- Group issues by **Severity**:
  - **High (Critical)**: Architecture/Anti-Fake Violations, Virtual Contracts cross-import leaks, missing DB indexes.
  - **Medium**: Missing Tests, Weak assertions, SRP violations, composition-root bypass.
  - **Low**: Formatting, Doc Links, missing Mermaid diagrams, missing JSDoc.
- **Actionable Advice**: Each item MUST clearly state:
  1. The exact file path that failed.
  2. The specific line number or function name.
  3. The exact terminal command or code change required to fix it.

**Final Output**: After saving the markdown report, you MUST output the entire verified task list (grouped by severity) directly into the chat so the user can immediately review and select the next task.
