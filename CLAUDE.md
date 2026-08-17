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

---

## 🧭 Docuvia-First Enforcement (Claude Code)

Full workflow and rationale: [AGENTS.md § Docuvia-First Development Workflow](AGENTS.md#-docuvia-first-development-workflow-mandatory). The short version, in Claude Code's own tool names:

- **Before `Grep`, `Glob`, or a broad `Read`** to explore the codebase: run `npx --no-install docuvia query "<concept_or_file>" --format=prompt` via `Bash` first. These three are the most expensive tools in this session — each scans or loads raw files with zero structural awareness, while a graph query answers "where is X" or "what calls Y" in milliseconds from the local SQLite index.
- **Before editing a symbol or file** (main agent or any subagent): run `npx --no-install docuvia impact <symbolOrFile>` via `Bash` to see who depends on it.
- **After making a code change that reflects a real architectural decision, rule, or notable rationale**: stage it via `npx --no-install docuvia analyze <file> --agent-authored --stage` (through `Bash`) — pipe a JSON payload on stdin (default) or pass `--decisions-file=<path>`, shape `{"decisions":[{"title":string,"content":string,"nodeType":"change"|"rule"|"decision"|"context","confidence":number}]}`. Put `--agent-authored`/`--stage` **after** the positional `<file>`, not before — a flag preceding the path silently swallows it as the flag's own value. It's flushed into the knowledge graph automatically the next time you commit a change touching that file — no further action needed.
- **This applies to every dispatched subagent that has `Read`/`Grep`/`Glob`/`Bash` in its tool list** (`backend-developer`, `database-schema-expert`, `shell-script-expert`, `tool-maker`, `task-verifier`, etc.) — they call `docuvia` the same way, through `Bash`, since there is no dedicated Docuvia tool on this platform. When dispatching one of these agents, brief it to query/impact-check before it explores or edits, don't assume it will infer that on its own.
- Fall back to `Grep`/`Glob`/`Read` only per the exceptions listed in AGENTS.md (empty/unprocessed graph result, a non-`exact` `match_type` — keyword/neighbor — on what should be a well-known symbol or file, need for exact source text, or a dynamic dependency `impact` can't see).
- If `npx --no-install docuvia <command>` 404s instead of running, that means the local `node_modules/.bin/docuvia` shim is stale, not that the CLI is broken — run `pnpm install --force` once, then retry (see [AGENTS.md § Installation](AGENTS.md#installation)).

<!-- docuvia:start -->

# Docuvia — Codebase Knowledge Evolver

This project uses Docuvia to manage architectural context and prevent blast-radius regressions.
Grep/Glob/Read are the most expensive tools available to you — before reaching for them to explore the codebase, query the local knowledge graph instead, and before editing a symbol or file, check its blast radius:

Run: `npx --no-install docuvia query "<concept_or_file>" --format=prompt`
Run: `npx --no-install docuvia impact <symbolOrFile>`

Use the results to understand architectural boundaries, historical decisions, and potential blast radius before modifying code. Only fall back to Grep/Glob/Read when the graph returns nothing, the target is flagged `tier_b_status="unprocessed"` (unknown, not zero), you need exact source text/formatting a structural query can't capture, or `query` returns a non-`exact` `match_type` (keyword/neighbor) for what should be a well-known symbol or file.

After making a code change that reflects a real architectural decision, rule, or notable rationale, stage it so the graph picks it up without a separate write step:

Run: `npx --no-install docuvia analyze <file> --agent-authored --stage`

Pipe a JSON payload on stdin (default) — `{"decisions":[{"title":string,"content":string,"nodeType":"change"|"rule"|"decision"|"context","confidence":number}]}` — or pass `--decisions-file=<path>` instead. Put `--agent-authored`/`--stage` after the positional `<file>`, not before — a flag preceding the path silently swallows it as the flag's own value. Staged decisions flush into the knowledge graph automatically the next time you commit a change touching that file — nothing else to run.
<!-- docuvia:end -->
