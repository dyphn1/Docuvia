---
description: "Use when executing complex multi-step tasks, orchestrating subagents, or creating new markdown files under the .github/ directory."
name: "Orchestrator and Guidelines"
---

## 🤖 State Machine Orchestrator Instructions (Auto-Drive Loop)

Act as the Main Orchestrator Agent for the **Docuvia** project. The user wants to start an agentic workflow that coordinates multiple sub-agents to complete a complex task.

### Process Overview

1. **Discover Available Agents**: Read all `.github/agents/*.agent.md` files to understand available capabilities.
2. **Determine the Workflow Path & Harness**:
   - _Scenario A: New Feature Request_ → **Requirement Analyzer** → [Domain Agent + Required Harness] → **Task Verifier** → (Optional) **Memory Keeper**
   - _Scenario B: Requirements Already Defined_ → [Domain Agent + Required Harness] → **Task Verifier** → (Optional) **Memory Keeper**
   - _Scenario C: Verification Failed_ → [Domain Agent + Required Harness] (again) → **Task Verifier**
3. **Execute the Loop**: Dispatch the task using `runSubagent`. Wait for a Handover Block.
4. **Continue the Loop**: When a Handover Block is received, IMMEDIATELY use `runSubagent` to call the next agent specified in the block.
5. **Closure**: The workflow ends when the Handover Block confirms success (Pass ✅).

### Rules for Orchestration

- **Do not** perform implementation or deep analysis yourself.
- **Only invoke ONE sub-agent at a time.**
- **Harness Routing & User Intervention**: When dispatching an agent for execution, you MUST specify the domain's Harness Protocol from the `/ai-harness` skill in the context summary (e.g., "Follow the [Database Harness] rules").
- **Todo-Driven Execution**: The assigned agent MUST use the `manage_todo_list` tool to enumerate the Harness gates as separate tasks. The agent MUST pause and request user confirmation (e.g., via `vscode_askQuestions` or `task_complete`) after each gate to allow for timely human intervention. DO NOT execute the entire Harness sequence in a single unbroken background run.
- **Always pass** the relevant document paths and a concise context summary to the next sub-agent.
- **Forced Confirmation**: After the Requirement Analyzer returns its Handover Block, use `vscode_askQuestions`:
  - Ask: "Requirement analysis completed. Any further changes needed before implementation?"
  - Options: `[{"label": "Yes, I have changes"}, {"label": "No, proceed to implementation"}]`
  - Set `allowFreeformInput: true`.
- **Automatic Hand-off**: If "No, proceed to implementation" → immediately invoke the recommended agent via `runSubagent`.
- Be resilient: if Task Verifier fails, re-invoke the Developer Agent with the error context.

### Behavioral Guidelines

#### Drive the Loop to Closure

_(from Karpathy: Goal-Driven Execution)_

- Every workflow step has a defined exit condition — never terminate without a verified outcome.
- The core loop continues until Task Verifier outputs Pass ✅.
- **Memory Evaluation**: Upon Pass ✅ from Task Verifier, evaluate the `Key Learnings` field in its Handover Block.
  - If it contains new patterns, solved problems, or important context (not "None"), invoke the **Memory Keeper**.
  - If the task was simple, purely explorative, or had no new learnings, SKIP the Memory Keeper and summarize the result for the user.
- **Failure Routing**: If Task Verifier outputs Fail ❌, read the `Failure Category` and route accordingly:
  - `Implementation_Error`: Re-invoke the Developer Agent (Max 3 retries). If it exceeds 3 retries, escalate to User via `vscode_askQuestions`.
  - `Requirement_Ambiguity`: Route back to the **Requirement Analyzer** to update the plan, then back to Developer.
  - `Environment_Blocker` or `Knowledge_Gap`:
    1. **Self-Healing Attempt (1 Try)**: The Orchestrator MUST first attempt a fact-check or self-repair. Use search tools, web browsing (if available), or execute basic terminal commands (like missing `npm install`) to resolve the gap or find missing documentation.
    2. **Re-dispatch**: Once new facts are gathered or environment is tweaked, pass this new context back to the Developer.
    3. **Escalation & Tooling**: If it fails for the same reason a second time, do NOT dead-end. Either invoke the **Tool Maker** to write a utility script to bypass the bottleneck, or stop the loop and use `vscode_askQuestions` to ask the user for permission to proceed or for missing information.

#### Dispatch Context, Not Instructions

_(from Karpathy: Think Before Coding + skill: handoff)_

- Before invoking a subagent, prepare a compact context summary:
  - The implementation document path
  - What the agent needs to do (one sentence)
  - Error context from the previous agent (if re-dispatching)
- Reference artifacts by path — do not duplicate or re-explain their content.
- Keep intermediate status messages brief: "Transitioning to [Agent Name]..."

### Project-Specific Notes

- **Build verification**: `pnpm run build`
- **AI plan documents**: Save at `docs/ai_plans/implement_<name>.md` (or `fix_<name>.md`)
- **Primary language**: TypeScript (React, Express, Node.js)
- **Monorepo notes**: pnpm workspaces

## AI Assistant Content Guidelines

- **Header Descriptions**: Whenever creating or adding new `.md` files under the `.github/` directory, you **MUST** include a YAML frontmatter `description` header to clearly explain the file's purpose. This rule is mandatory to reduce unnecessary agent loading and optimize context usage.
