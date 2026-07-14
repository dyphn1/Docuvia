# Docuvia2 — AI Developer Guide

> **CRITICAL INSTRUCTION FOR ALL AI AGENTS & DEVELOPERS:**
> Docuvia2 is built on a strict, non-negotiable **Two-Layer Virtual Contracts Architecture**. Do not write a single line of implementation code without reading and understanding the architecture guides in `docs/gitbook/architecture/`.

## 🏛️ Core Architectural Mandates

1. **Virtual Contracts (`lib/contracts`)**: All implementations must map to interfaces defined here. Cross-importing between implementation libraries (`lib/schema`, `lib/ast-core`, `lib/libgit2`) is strictly forbidden.
2. **Lifecycle & State**: Implementations do not manage their own lifecycles. They self-register to `docuviaFactory`, are instantiated transiently by the Orchestration layer (`lib/ui-core`), and rely on `docuviaMemory` with UUID scoping for configuration. Do not read `process.env` in implementation libraries.
3. **Error Handling**: Do not swallow errors with empty `catch` blocks or use `console.error`. All errors must be wrapped in `DocuviaError` with a specific Error Code and thrown upwards. Only the Presentation layer (`artifacts/cli`, `mcp`) is allowed to log final unrecoverable errors.
4. **Logging**: Do not use `console.log` or `console.error` (to prevent MCP stdout corruption). Use the event-driven `logger` injected by the Orchestrator. Tech Providers (like DB or Git wrappers) are "Silent Workers" and do not receive the logger at all.
5. **Testing**: Test-Driven Development (TDD) is mandatory. Orchestration logic uses pure mocks injected via the Factory Lock, while Implementation logic uses isolated integration tests against real temporary resources.

## 📚 Required Reading

Before modifying or creating any core mechanism, you MUST read the corresponding architecture document to ensure implementation consistency:

- [The Virtual Contracts Architecture](docs/gitbook/architecture/virtual-contracts-architecture.md)
- [Application Lifecycle & State Management](docs/gitbook/architecture/application-lifecycle-and-state.md)
- [Unified Error Handling Strategy](docs/gitbook/architecture/error-handling-architecture.md)
- [Event-Driven Logging](docs/gitbook/architecture/logging-architecture.md)
- [Testing & Quality Gates](docs/gitbook/architecture/testing-and-quality-architecture.md)
- [IPC Logging Architecture](docs/gitbook/architecture/ipc-logging-architecture.md) — required before touching `worker_threads`/`child_process` code (e.g. `lib/core/src/ast/`)

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Docuvia** (2859 symbols, 6947 relationships, 209 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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

## Cross-Repo Groups

This repository is listed under GitNexus **group(s): my_workspace** (see `~/.gitnexus/groups/`). For cross-repo analysis, use MCP tools `impact`, `query`, and `context` with `repo` set to `@<groupName>` or `@<groupName>/<memberPath>` (paths match keys in that group’s `group.yaml`). Use `group_list` / `group_sync` for membership and sync. From the project root: `node .gitnexus/run.cjs group list`, `node .gitnexus/run.cjs group sync <name>`, `node .gitnexus/run.cjs group impact <name> --target <symbol> --repo <group-path>` (the `.gitnexus/run.cjs` path is repo-root-relative).

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
