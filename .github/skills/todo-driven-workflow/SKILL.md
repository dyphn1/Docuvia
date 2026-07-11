---
name: todo-driven-workflow
description: Enforces a deliberate, step-by-step execution loop using the manage_todo_list tool to break down complex tasks, track exact state, and prevent hallucinated progress.
version: 1.0.0
author: Docuvia Core Team
---

# Todo-Driven Workflow Skill

This skill enforces a disciplined execution loop using the `manage_todo_list` tool. It prevents "hallucinated progress" and "compliance theater" by forcing the Agent to break down complex tasks, track exact state, and prove completion before moving to the next step.

## When to Use

- When the user asks to "use the todo list workflow", "break this down", "step by step", or "do it like last time".
- When tackling complex, multi-file refactoring or deep architectural changes.
- When untangling technical debt or auditing "done" features.
- When the task requires multiple sequential validations (e.g., compile -> test -> fix).

## Prerequisites

- Access to the `manage_todo_list` tool.
- A clear understanding of the user's high-level goal.

## Procedure

### 1. Analyze and Plan (Think)

Before taking any action or modifying any code, analyze the user's request. Break the goal into 3 to 7 concrete, verifiable sub-tasks.

### 2. Initialize the Todo List (Record)

Call the `manage_todo_list` tool with your initial plan. Set all tasks to `not-started`.
_Rule:_ Do NOT start actual coding or heavy file reading until the list is initialized and presented to the user.

### 3. Execution Loop (Try -> Summarize -> Record)

For each task in the list, strictly follow this loop:

1. **Start**: Update the list to mark the current task as `in-progress` (only ONE task can be in-progress at a time).
2. **Execute**: Perform the necessary actions (read files, grep, run terminal commands, edit files).
3. **Verify**: Prove the changes work. Use terminal commands like `pnpm run build`, `pnpm test`, or `git diff` to gather evidence (Law of Evidence Assertion).
4. **Complete**: Once verified, update the list to mark the task as `completed`.

### 4. Handling Failures (Dynamic Adaptation)

If a step fails or uncovers a deeper issue:

- Do NOT silently ignore it or pretend it worked.
- Add a new `not-started` task to the Todo list specifically to address the new blocker (e.g., "Fix TS compilation error in module X").
- Mark the current task as `in-progress` until the blocker is resolved, or re-arrange the list dynamically to reflect reality.

### 5. Completion

Once all items are `completed`, summarize the overall outcome for the user and explicitly call the `task_complete` tool.

## Pitfalls

- **Batching Status Updates**: Do not update a task to `in-progress` and `completed` in the same turn. The user needs to see what you are currently working on.
- **Skipping Verification**: Never mark a task `completed` if you haven't verified it compiles or runs successfully. Hallucinating success violates the Law of Evidence Assertion.
- **Ghost Tasks**: Ensure every action you take maps to a task on the list. If you are doing something not on the list, add it to the list first.
