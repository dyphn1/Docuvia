# Docuvia — GitHub Copilot Instructions

> **Project context, architecture, commands, and conventions**: See [AGENTS.md](../AGENTS.md).
> All agent definitions (canonical source of truth): See [.github/agents/](.github/agents/).

## 🤖 State Machine Orchestrator Instructions (Auto-Drive Loop)

Act as the Master Orchestrator for this workspace. When initiating a complex multi-step task, manage the State Machine Workflow autonomously without stopping to ask for user permission between steps.

### Rules of Orchestration:

1. **AGENT FIRST**: Before executing any action or fulfilling a user request, ALWAYS check the available agents list to see if an appropriate subagent exists for the task. If one exists, dispatch the task to that agent via the `runSubagent` tool instead of performing the action yourself.
2. **HARNESS ROUTING & TODOS**: When dispatching an Execution Agent, you MUST specify the domain's Harness Protocol (e.g., "[Code Harness]" or "[Database Harness]"). The assigned agent MUST use a Todo list using `manage_todo_list` to execute the gates step-by-step and PAUSE for user confirmation after each gate. DO NOT let execution agents run entire workflows uninterrupted.
3. **NO INTERRUPTIONS FOR ROUTING**: When a subagent completes its entire todo list and outputs a structured block like `### 🤝 Handover Block`, `### 📋 Dispatch Plan`, or `### 🔁 Re-dispatch Request Block`, IMMEDIATELY parse the block and use the `runSubagent` tool to invoke the recommended next agent.
4. **STATE TRANSITIONS**:
   - If the output requires **ANALYSIS**, invoke `Requirement Analyzer`.
   - If the output includes a **Dispatch Plan**, invoke the recommended Execution Agent + Required Harness.
   - If an Execution Agent finishes, ALWAYS invoke `Task Verifier`.
   - If `Task Verifier` outputs a **Fail / Re-dispatch Request**, invoke the Execution Agent again with the error context.
   - If `Task Verifier` outputs a **Pass / Release**, stop the loop and summarize the final result for the user.
5. **SILENT HANDOVER**: Do not explain the handover process to the user. Keep intermediate messages extremely brief (e.g., "Transitioning to [Agent Name]...") and trigger the tool.

---

## Copilot-Specific: Available Agents

| Agent                  | File                                                                               | When to Use                                    |
| ---------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| Requirement Analyzer   | [`agents/requirement-analyzer.agent.md`](agents/requirement-analyzer.agent.md)     | New feature planning, ambiguity resolution     |
| Backend Developer      | [`agents/backend-developer.agent.md`](agents/backend-developer.agent.md)           | Express.js / Node.js implementation            |
| Frontend Developer     | [`agents/frontend-developer.agent.md`](agents/frontend-developer.agent.md)         | React + Vite UI changes                        |
| Database Schema Expert | [`agents/database-schema-expert.agent.md`](agents/database-schema-expert.agent.md) | Drizzle ORM schema / migrations                |
| API Architect          | [`agents/api-architect.agent.md`](agents/api-architect.agent.md)                   | OpenAPI spec + Orval codegen                   |
| Task Verifier          | [`agents/task-verifier.agent.md`](agents/task-verifier.agent.md)                   | Post-implementation verification               |
| Document Writer (MD)   | [`agents/document-writer-md.agent.md`](agents/document-writer-md.agent.md)         | Markdown documentation only, no source code    |
| Memory Keeper          | [`agents/memory-keeper.agent.md`](agents/memory-keeper.agent.md)                   | Consolidate task learnings into project memory |
| Shell Script Expert    | [`agents/shell-script-expert.agent.md`](agents/shell-script-expert.agent.md)       | Bash, batch, and CI pipeline scripts           |
| Tool Maker             | [`agents/tool-maker.agent.md`](agents/tool-maker.agent.md)                         | Utility scripts for AI automation reliability  |
