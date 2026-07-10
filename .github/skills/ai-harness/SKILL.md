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

### 1. [Code Harness] — For Backend/Frontend Developers

_Applies to: TypeScript, React, Node.js logic._

- **[ ] Gate 1: Impact Analysis**: Run GitNexus `impact()` on the target. If blast radius > 15 files, stop and ask user.
- **[ ] Gate 2: Contract**: Write TS Interfaces first. Run `pnpm run typecheck`. It MUST pass before writing logic.
- **[ ] Gate 3: Red Test**: Write a failing test. Prove it fails with real terminal output.
- **[ ] Gate 4: Green Implementation**: Write the logic. Prove the test passes.

### 2. [Database Harness] — For Database Schema Experts

_Applies to: Drizzle ORM, PostgreSQL schema changes._

- **[ ] Gate 1: State Review**: Read the current schema in `lib/db/src/schema/`. Do not guess relationships.
- **[ ] Gate 2: Dry-Run**: Make the schema changes and run the Drizzle generation commands to ensure the ORM compiler accepts the syntax.
- **[ ] Gate 3: Apply & Verify**: If generation fails, stop and fix. Do not proceed until physical schema compilation passes.

### 3. [API Harness] — For API Architects

_Applies to: OpenAPI spec, Orval codegen, React Query hooks, Zod validators._

- **[ ] Gate 1: Single Source Edit**: Edit `lib/api-spec/openapi.yaml`. NEVER manually edit Zod validators or React Query hooks.
- **[ ] Gate 2: Codegen**: Run `pnpm --filter @workspace/api-spec run codegen`.
- **[ ] Gate 3: Typecheck**: Run `pnpm run typecheck` to prove the newly generated APIs didn't break consuming packages.

### 4. [Docs Harness] — For Document Writers (MD)

_Applies to: README, GitBook, ADRs, Architectural docs._

- **[ ] Gate 1: Vocabulary Sync**: Read `.github/memory/MEMORY.md` first to use existing project terminology.
- **[ ] Gate 2: Link Verification**: If modifying a relative markdown link, use `list_dir` or file reading tools to physically verify the target file exists. Hallucinated links are strictly forbidden.

---

## 🚦 Execution Rules

Whenever you (or a subagent) act under a Harness:

1. Translate the Gates into the `manage_todo_list`.
2. Provide terminal output or tool execution evidence proving you passed the current gate.
3. Pause and ensure the user has a chance to intervene before the next gate begins.
