---
name: ai-harness
description: "Applies strict pre-execution physical constraints (Harnesses) across different engineering domains (Code, DB, API, Docs) to prevent AI hallucination."
---

# AI Harness Protocol (Multi-Domain Constraint System)

**Trigger**: `/ai-harness`
**Purpose**: Engineering is more than writing code. This protocol enforces the **Harness Spirit**: "No execution without a physical validation gate." It integrates tightly with the `todo-driven-workflow` to ensure every domain's behavior is explicitly enumerated as a Todo list, allowing the user to confirm and intervene at each step.

## 🧠 Core Philosophy & Todo Integration

Before starting work, identify your domain and apply the corresponding Harness.

1. **Initialize**: You MUST use the `manage_todo_list` tool to translate the domain's Gates (listed below) into sequential Todo items.
2. **Step-by-Step Transparency**: Do NOT execute all gates at once. You must execute them one by one, updating the Todo list status (`in-progress` -> `completed`), and **pause to allow user intervention** (e.g., via `vscode_askQuestions` or returning control to the user) between major gates.

---

## 🛠️ Domain-Specific Harnesses (Todo Templates)

### 1. [Code Harness] — For Backend Developers

_Applies to: TypeScript/Node.js logic in `artifacts/cli/` (CLI + embedded MCP server) and `lib/*` packages. This project has no web frontend — do not apply this harness to React work._

- **[ ] Gate 1: Impact Analysis**: Run `npx --no-install docuvia impact <target>` on the target (this project's own knowledge graph — do NOT use GitNexus here, see [[user-prefers-docuvia-over-gitnexus]] / `.github/memory/architecture.md`'s Navigation section). If blast radius > 15 files, stop and ask user. Note: `impact` currently only tracks `calls`/`implements`/`extends` edges (not raw imports or dynamically-loaded paths like `worker_threads`) — cross-check dynamically-loaded files by symbol name or manual grep if the target is one.
- **[ ] Gate 2: Contract**: Write TS Interfaces first. Run `pnpm run typecheck`. It MUST pass before writing logic.
- **[ ] Gate 3: Red Test**: Write a failing test. Prove it fails with real terminal output.
- **[ ] Gate 4: Green Implementation**: Write the logic. Prove the test passes.

### 2. [Database Harness] — For Database Schema Experts

_Applies to: hand-written SQLite migrations (no ORM — see `.github/agents/database-schema-expert.agent.md`)._

- **[ ] Gate 1: State Review**: Read the current migrations in `lib/schema/src/sqlite/migrations/` and repos in `lib/schema/src/sqlite/repos/`. Do not guess relationships.
- **[ ] Gate 2: Dry-Run**: Add a new numbered `.sql` migration file (never edit an already-applied one) and run `pnpm run typecheck` plus the `lib/schema` test suite to confirm it applies cleanly against a fresh DB.
- **[ ] Gate 3: Apply & Verify**: If a test fails, stop and fix. Do not proceed until the migration applies and tests pass.

### 3. [Docs Harness] — For Document Writers (MD)

_Applies to: README, GitBook, ADRs, Architectural docs._

- **[ ] Gate 1: Vocabulary Sync**: Read `.github/memory/MEMORY.md` first to use existing project terminology.
- **[ ] Gate 2: Link Verification**: If modifying a relative markdown link, use `list_dir` or file reading tools to physically verify the target file exists. Hallucinated links are strictly forbidden.

---

## 🚦 Execution Rules

Whenever you (or a subagent) act under a Harness:

1. Translate the Gates into the `manage_todo_list`.
2. Provide terminal output or tool execution evidence proving you passed the current gate.
3. Pause and ensure the user has a chance to intervene before the next gate begins.
