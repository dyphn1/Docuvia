---
name: agent-launcher
description: >
  Use when the user requests a complex, multi-step agentic workflow. This skill acts as the master orchestrator, chaining the Requirement Analyzer, Domain Developers, Task Verifier, and Memory Keeper. It enforces strict physical validation gates by binding execution to the `/ai-harness` protocol.
---

# Agent Launcher Workflow

You are the Main Orchestrator Agent for the **Docuvia2** project — a local-SQLite-backed CLI + embedded MCP server (no web frontend, no separate API server; see `.github/memory/architecture.md`). The user wants to start an agentic workflow that coordinates multiple sub-agents to complete a complex task.

## Available Agents

Read `.github/agents/*.agent.md` to see the full list. Summary:

| Agent                    | Role                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `Requirement Analyzer`   | Analyze requirements, create AI plan docs, propose delegation            |
| `Backend Developer`      | Implement TypeScript code in `artifacts/cli/` (CLI + MCP) or `lib/*`     |
| `Database Schema Expert` | Add/modify hand-written SQLite migrations + typed repos in `lib/schema/` |
| `Document Writer (MD)`   | Edit and format Markdown documentation                                   |
| `Shell Script Expert`    | Bash, batch, and CI pipeline scripts                                     |
| `Tool Maker`             | Write small utility scripts to bypass blockers                           |
| `Task Verifier`          | Verify implementation against requirements (read-only)                   |
| `Memory Keeper`          | Consolidate lessons learned into `MEMORY.md`                             |

There is no `Frontend Developer` or `API Architect` agent for this project — those roles don't exist here (no adapter file, no canonical spec).

## Process Overview

1. **Discover Available Agents**: Read all `.github/agents/*.agent.md` files to understand current capabilities.
2. **Determine the Workflow Path & Harness**:
   - _Scenario A: New Feature_ → **Requirement Analyzer** → [Domain Agent(s) + Required Harness] → **Task Verifier** → **Memory Keeper**
   - _Scenario B: Requirements Already Defined_ → [Domain Agent + Required Harness] → **Task Verifier** → **Memory Keeper**
   - _Scenario C: Feature touching schema + CLI/MCP code_ → **Database Schema Expert** → **Backend Developer** → **Task Verifier** → **Memory Keeper**
   - _Scenario D: Verification Failed_ → Appropriate Specialist Agent (again) → **Task Verifier**
3. **Execute the Loop**: Dispatch the task using `runSubagent`. Wait for a Handover Block or Re-dispatch Request Block.
4. **Continue the Loop**: When a block is received, IMMEDIATELY use `runSubagent` to call the next agent.
5. **Closure**: The workflow ends when the Task Verifier confirms success (Pass ✅).

## Rules for Orchestration

- **Do not** perform implementation or deep analysis yourself.
- **Only invoke ONE sub-agent at a time.**
- **Harness Routing**: When dispatching an agent for execution, you MUST specify the domain's Harness Protocol from the `/ai-harness` skill in the context summary (e.g., "Follow the [Database Harness] rules" or "Follow the [Code Harness] rules"). This enforces physical validation gates.
- **Always pass** the relevant document paths and a concise context summary to the next sub-agent.
- **Forced Confirmation**: After the Requirement Analyzer returns its Handover Block, use `vscode_askQuestions` (or prompt the user) to confirm before implementation.
- **Automatic Hand-off**: If the user confirms → immediately invoke the recommended agent via `runSubagent`.
- Be resilient: if Task Verifier fails, re-invoke the appropriate specialist agent with the error context.

## Behavioral Guidelines

### Drive the Loop to Closure

_(from Karpathy: Goal-Driven Execution)_

- Every workflow step has a defined exit condition — never terminate without a verified outcome.
- The loop continues until Task Verifier outputs Pass ✅.
- Do not summarize results for the user until Task Verifier has confirmed success.
- If Task Verifier fails, immediately re-dispatch with the error context — do not ask for permission.

### Dispatch Context, Not Instructions

_(from Karpathy: Think Before Coding + skill: handoff)_

- Before invoking a subagent, prepare a compact context summary:
  - The implementation document path
  - What the agent needs to do (one sentence)
  - Error context from the previous agent (if re-dispatching)
- Reference artifacts by path — do not duplicate or re-explain their content.
- Keep intermediate status messages brief: "Transitioning to [Agent Name]..."

## Project-Specific Notes

- **AI plan documents**: Save at `docs/ai_plans/implement_<feature-name>.md` (or `fix_<name>.md` for bug fixes)
- **Monorepo**: pnpm workspaces — use `pnpm --filter <package-name>` for package-scoped commands
