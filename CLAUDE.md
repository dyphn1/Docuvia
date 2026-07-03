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
| frontend-developer     | [`.claude/agents/frontend-developer.md`](.claude/agents/frontend-developer.md)         | [`.github/agents/frontend-developer.agent.md`](.github/agents/frontend-developer.agent.md)         |
| database-schema-expert | [`.claude/agents/database-schema-expert.md`](.claude/agents/database-schema-expert.md) | [`.github/agents/database-schema-expert.agent.md`](.github/agents/database-schema-expert.agent.md) |
| api-architect          | [`.claude/agents/api-architect.md`](.claude/agents/api-architect.md)                   | [`.github/agents/api-architect.agent.md`](.github/agents/api-architect.agent.md)                   |
| task-verifier          | [`.claude/agents/task-verifier.md`](.claude/agents/task-verifier.md)                   | [`.github/agents/task-verifier.agent.md`](.github/agents/task-verifier.agent.md)                   |
| document-writer-md     | [`.claude/agents/document-writer-md.md`](.claude/agents/document-writer-md.md)         | [`.github/agents/document-writer-md.agent.md`](.github/agents/document-writer-md.agent.md)         |
| memory-keeper          | [`.claude/agents/memory-keeper.md`](.claude/agents/memory-keeper.md)                   | [`.github/agents/memory-keeper.agent.md`](.github/agents/memory-keeper.agent.md)                   |
| shell-script-expert    | [`.claude/agents/shell-script-expert.md`](.claude/agents/shell-script-expert.md)       | [`.github/agents/shell-script-expert.agent.md`](.github/agents/shell-script-expert.agent.md)       |
| tool-maker             | [`.claude/agents/tool-maker.md`](.claude/agents/tool-maker.md)                         | [`.github/agents/tool-maker.agent.md`](.github/agents/tool-maker.agent.md)                         |

---

## Claude-Specific Notes

- Tool names use Claude Code syntax: `Read`, `Edit`, `Glob`, `Grep`, `Bash`
- Note: `AskUserQuestion` is **not available** to subagents (Claude Code platform restriction)
- Subagents cannot spawn further subagents — output a Handover Block instead
- Save AI implementation plans at `docs/ai_plans/implement_<feature-name>.md`

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Docuvia** (4959 symbols, 10766 relationships, 214 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource                                 | Use for                                  |
| ---------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/Docuvia/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/Docuvia/clusters`       | All functional areas                     |
| `gitnexus://repo/Docuvia/processes`      | All execution flows                      |
| `gitnexus://repo/Docuvia/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
