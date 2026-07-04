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
2. **Categorize by Functional Area**: Record the files and group them into logical domains (e.g., `api-server routes`, `kg-engine UI`, `database schema`, `documentation`, `core services`).
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

### Round 2: API & Database Contract Validation

**Agents Assigned:** `Explore`, `database-schema-expert`
**Audit Actions (HOW TO DO IT):**

1. **API-First Enforcement**: Run `grep -rn 'fetch(' artifacts/kg-engine/src/` and `grep -rn 'axios' artifacts/kg-engine/src/`. If any manual HTTP calls are found, flag them as Severe. All API calls MUST use the auto-generated `@workspace/api-client-react` hooks.
2. **Schema Integrity**: Read files in `lib/db/src/schema/`. Verify that knowledge tier tables (`l1_tags`, `l2_nodes`, `l3_nodes`) exist. Verify they have explicit index declarations (e.g., `(table) => ({ ... index(...) })`). Flag missing indexes.
3. **Roadmap Truthfulness Check**: Read `docs/gitbook/evaluate/index.md` and `docs/gitbook/roadmap/`. For every `[x]` (completed item), find the corresponding source file. If the source file contains `TODO`, `stub`, or hardcoded mock returns, flag it as a "False Positive" and instruct the user to downgrade the markdown file to `[ ]`.

### Round 3: Implementation Verification

**Agents Assigned:** `Explore`, `task-verifier`
**Audit Actions (HOW TO DO IT):**

1. **Anti-Fake Sweep**: Run `grep -rnw -iE 'stub|todo|mock|dummy' artifacts/ lib/ --exclude-dir=test --exclude-dir=tests --exclude-dir=generated`. Any matches in production code MUST be flagged as Severe Architecture/Anti-Fake Violations.
2. **Single Responsibility Principle (SRP) & Naming**: Inspect source files and their contents. Verify that file names accurately reflect their responsibilities. Internal functions must do exactly what their names imply without hidden side effects. Flag any file or function violating SRP (e.g., mixing presentation logic with DB queries).
3. **DRY Principle (Don't Repeat Yourself)**: Scan for duplicated logic. If the same logic pattern, data transformation, or error-handling structure is repeated 3 or more times across the codebase, flag it to be refactored into a more concise, shared utility or helper.
4. **Architectural Purity & MVC**: Ensure clean separation of concerns. Run `grep -rn 'artifacts/api-server' artifacts/kg-engine/src/` to ensure the frontend doesn't illegally import backend code. In the backend, ensure Route Controllers strictly delegate business logic and DB queries to Service/Model layers instead of handling them directly.

### Round 4: Test Quality Validation

**Agents Assigned:** `Explore`, `task-verifier`
**Audit Actions (HOW TO DO IT):**

1. **3A Enforcement**: Find and open 3 random `*.unit.test.ts` files. Verify that the Arrange (setup data), Act (call function), and Assert (verify result) phases are visually or logically separated. Flag messy tests.
2. **Deep Assertion Check**: Run `grep -rn 'toBeDefined()' artifacts/` and `grep -rn 'toBeTruthy()' artifacts/`. Flag assertions that only check existence. Tests MUST verify specific payload structures or DB state changes (using the `withRollback` wrapper).
3. **Sad Path Coverage**: Read `artifacts/api-server/test/setup/msw/handlers.ts`. Verify the presence of HTTP 4xx/5xx mock responses. Flag if only "Happy Path" (200 OK) responses exist.
4. **Metrics Verification**: Run `pnpm run test:coverage` in the terminal. Wait for the output. Flag any core package (`api-server`, `kg-engine`, `db`) that shows less than 80% Statement coverage.

### Phase 2: Final Reporting

After all functional categories in the Todo list are marked `completed`, create a consolidated report file: `docs/reports/audit-report-[DATE].md`.
**Memory Persistence**: You MUST also record the path of this new report and a summary of the pending High (Critical) tasks into `/memories/repo/active_audit.md` (using the memory tool) so the AI context never loses track of the remaining audit debt.

**Formatting Rules:**

- The report MUST be formatted as a **Prioritized Task List** (checkboxes `[ ]`).
- Group issues by **Severity**:
  - **High (Critical)**: Architecture/Anti-Fake Violations, OpenAPI manual fetches, missing DB indexes, cross-package boundary leaks.
  - **Medium**: Missing Tests, Weak assertions, SRP/Fat controller violations, Middleware order issues.
  - **Low**: Formatting, Doc Links, missing Mermaid diagrams, missing JSDoc.
- **Actionable Advice**: Each item MUST clearly state:
  1. The exact file path that failed.
  2. The specific line number or function name.
  3. The exact terminal command or code change required to fix it.

**Final Output**: After saving the markdown report, you MUST output the entire verified task list (grouped by severity) directly into the chat so the user can immediately review and select the next task.
