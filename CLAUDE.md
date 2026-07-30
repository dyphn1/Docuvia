# Docuvia — Claude Code Instructions

> **Project context, architecture, commands, and conventions**: See [AGENTS.md](AGENTS.md).
> All agent definitions (canonical source of truth): See [.github/agents/](.github/agents/).
> Platform adapters for Claude: See [.claude/agents/](.claude/agents/).

---

## 🤖 State Machine Orchestrator Instructions (Auto-Drive Loop)

Act as the Master Orchestrator for this workspace. When initiating a complex multi-step task, manage the State Machine Workflow autonomously without stopping to ask for user permission between steps.

### Rules of Orchestration:

1. **AGENT FIRST**: Before executing any action or fulfilling a user request, ALWAYS check `.claude/agents/` for a suitable subagent. If one exists, dispatch the task to that agent instead of performing the action yourself.
2. **NO INTERRUPTIONS**: When a subagent completes and outputs a `### 🤝 Handover Block`, `### 📋 Dispatch Plan`, or `### 🔁 Re-dispatch Request Block`, IMMEDIATELY parse the block and invoke the recommended next agent.
3. **DO NOT ASK FOR PERMISSION**: Do not ask "Would you like me to invoke the agent now?". Invoke the agent immediately.
4. **STATE TRANSITIONS**:
   - Analysis required → invoke `requirement-analyzer`
   - Dispatch Plan present → invoke the recommended Execution Agent
   - Execution Agent finished → ALWAYS invoke `task-verifier`
   - `task-verifier` Fail → re-invoke the Execution Agent with error context
   - `task-verifier` Pass → stop loop and summarize for the user
5. **SILENT HANDOVER**: Keep inter-agent messages very brief and transition immediately.

---

## Claude-Specific: Available Agents

Each agent below is a thin adapter that loads the canonical spec from `.github/agents/`.

| Agent                  | Adapter file                                                                           | Canonical Source                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| requirement-analyzer   | [`.claude/agents/requirement-analyzer.md`](.claude/agents/requirement-analyzer.md)     | [`.github/agents/requirement-analyzer.agent.md`](.github/agents/requirement-analyzer.agent.md)     |
| backend-developer      | [`.claude/agents/backend-developer.md`](.claude/agents/backend-developer.md)           | [`.github/agents/backend-developer.agent.md`](.github/agents/backend-developer.agent.md)           |
| database-schema-expert | [`.claude/agents/database-schema-expert.md`](.claude/agents/database-schema-expert.md) | [`.github/agents/database-schema-expert.agent.md`](.github/agents/database-schema-expert.agent.md) |
| task-verifier          | [`.claude/agents/task-verifier.md`](.claude/agents/task-verifier.md)                   | [`.github/agents/task-verifier.agent.md`](.github/agents/task-verifier.agent.md)                   |
| document-writer-md     | [`.claude/agents/document-writer-md.md`](.claude/agents/document-writer-md.md)         | [`.github/agents/document-writer-md.agent.md`](.github/agents/document-writer-md.agent.md)         |
| memory-keeper          | [`.claude/agents/memory-keeper.md`](.claude/agents/memory-keeper.md)                   | [`.github/agents/memory-keeper.agent.md`](.github/agents/memory-keeper.agent.md)                   |
| shell-script-expert    | [`.claude/agents/shell-script-expert.md`](.claude/agents/shell-script-expert.md)       | [`.github/agents/shell-script-expert.agent.md`](.github/agents/shell-script-expert.agent.md)       |
| tool-maker             | [`.claude/agents/tool-maker.md`](.claude/agents/tool-maker.md)                         | [`.github/agents/tool-maker.agent.md`](.github/agents/tool-maker.agent.md)                         |

> `frontend-developer` and `api-architect` were removed from this table (2026-07-30): neither has an adapter file in `.claude/agents/` or a canonical spec in `.github/agents/`, and this project has no web frontend or separate API server for them to own (see AGENTS.md / `.github/memory/architecture.md`). Those two roles were leftover boilerplate from a generic template, never real for Docuvia2.

---

## Claude-Specific Notes

- Tool names use Claude Code syntax: `Read`, `Edit`, `Glob`, `Grep`, `Bash`
- Note: `AskUserQuestion` is **not available** to subagents (Claude Code platform restriction)
- Subagents cannot spawn further subagents — output a Handover Block instead
- Save AI implementation plans at `docs/ai_plans/implement_<feature-name>.md`

<!-- docuvia:start -->

# Docuvia — Codebase Knowledge Evolver

This project uses Docuvia to manage architectural context and prevent blast-radius regressions.
Before you explore the codebase (using Grep/Glob/Read) or make structural changes, you MUST query the local knowledge graph:

Run: `npx --no-install docuvia query "<concept_or_file>" --format=prompt`

Use the results from this command to understand architectural boundaries, historical decisions, and potential blast radius before modifying code.
<!-- docuvia:end -->
