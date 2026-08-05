# Docuvia2 — AI Developer Guide

> **CRITICAL INSTRUCTION FOR ALL AI AGENTS & DEVELOPERS:**
> Docuvia2 is built on a strict, non-negotiable **Two-Layer Virtual Contracts Architecture**. Do not write a single line of implementation code without reading and understanding the architecture guides in `docs/gitbook/architecture/`, and without querying the local knowledge graph first (see [Docuvia-First Development Workflow](#-docuvia-first-development-workflow-mandatory) below).

## Installation

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm run build
```

If `npx --no-install docuvia <command>` fails to resolve and falls through to a registry 404, run `pnpm install --force` once — it regenerates the workspace's `node_modules/.bin/docuvia` shim, which can go stale after a fresh clone or a Node/pnpm upgrade. Verify with `npx docuvia doctor`. Full environment requirements (Node/pnpm/Git versions, optional per-language LSP servers for Tier B) are in [README.md](README.md#installation).

## Project Structure

Docuvia2 is a pnpm workspace (`lib/*`, `artifacts/*`). Every package maps to exactly one layer of the [Virtual Contracts Architecture](docs/gitbook/architecture/virtual-contracts-architecture.md) — see [Core Architectural Mandates](#-core-architectural-mandates) for the rules governing what may depend on what.

| Path                                | Package                  | Layer               | Responsibility                                                                                                                                              |
| ----------------------------------- | ------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/contracts`                     | `@workspace/contracts`   | Virtual Contracts   | Interfaces, error codes, factory/logging/memory contracts. Zero runtime logic.                                                                              |
| `lib/schema`                        | `@workspace/schema`      | Technology Provider | SQLite schema, migrations, typed repos — the knowledge graph's storage engine.                                                                              |
| `lib/git-local`                     | `@workspace/git-local`   | Technology Provider | Local Git history ingestion (`libgit2`-backed), fast-import.                                                                                                |
| `lib/llm-api`                       | `@workspace/llm-api`     | Technology Provider | LLM API client wrapper.                                                                                                                                     |
| `lib/remote-api`                    | `@workspace/remote-api`  | Technology Provider | Remote backend client used by `publish` / `sync-knowledge`.                                                                                                 |
| `lib/ast-core`                      | `@workspace/ast-core`    | Domain Core         | AST microkernel: tree-sitter bridge, traversal, edge computation, compression, language detection.                                                          |
| `lib/plugins-ast`                   | `@workspace/plugins-ast` | Domain Core         | Per-language AST extraction plugins — one file per supported language (`lib/plugins-ast/src/languages/`).                                                   |
| `lib/core`                          | `@workspace/core`        | Domain Core         | Business logic: AST worker pool/ingestion, git diff detection, graph persistence, blast-radius/impact scoring, LSP escalation, FTS5 query, topology export. |
| `lib/ui-core`                       | `@workspace/ui-core`     | Orchestration Layer | Workflows, `docuviaFactory` / `docuviaMemory`, wizard UI, the `docuvia-api` facade.                                                                         |
| `artifacts/cli`                     | `@workspace/cli`         | Presentation Layer  | The `docuvia` CLI — argument parsing, per-platform `init` installers, output formatting.                                                                    |
| `docs/gitbook`                      | —                        | Docs                | GitBook-structured documentation: architecture, guidelines, user guide, ADRs, workflows, analysis.                                                          |
| `.github/agents` / `.claude/agents` | —                        | Agents              | Canonical subagent specs (`*.agent.md`) and their thin per-platform adapters (Claude, etc.).                                                                |

## 🏛️ Core Architectural Mandates

1. **Virtual Contracts (`lib/contracts`)**: All implementations must map to interfaces defined here. Cross-importing between implementation libraries (`lib/schema`, `lib/ast-core`, `lib/git-local`) is strictly forbidden.
2. **Lifecycle & State**: Implementations do not manage their own lifecycles. They self-register to `docuviaFactory`, are instantiated transiently by the Orchestration layer (`lib/ui-core`), and rely on `docuviaMemory` with UUID scoping for configuration. Do not read `process.env` in implementation libraries.
3. **Error Handling**: Do not swallow errors with empty `catch` blocks or use `console.error`. All errors must be wrapped in `DocuviaError` with a specific Error Code and thrown upwards. Only the Presentation layer (`artifacts/cli`, `mcp`) is allowed to log final unrecoverable errors.
4. **Logging**: Do not use `console.log` or `console.error` (to prevent MCP stdout corruption). Use the event-driven `logger` injected by the Orchestrator. Tech Providers (like DB or Git wrappers) are "Silent Workers" and do not receive the logger at all.
5. **Testing**: Test-Driven Development (TDD) is mandatory. Orchestration logic uses pure mocks injected via the Factory Lock, while Implementation logic uses isolated integration tests against real temporary resources.

## Coding Conventions

**Where does new code go?** (full decision tree: [File Placement & Folder Rules](docs/gitbook/guidelines/file-placement-rules.md))

- Defining a shape, error, or shared type → `lib/contracts/src/` — interfaces/types/enums only, zero runtime logic.
- Wrapping a third-party technology (a new DB, a new git tool) → `lib/<tech-name>/src/` — a Technology Provider; self-registers to `docuviaFactory`, no business logic.
- Core business logic (blast radius, semantic diffing, ...) → `lib/core/src/<domain>/` — the Domain Core; knows _what_ to do with data, not _how_ it was fetched.
- Combining multiple tools to complete a user task → `lib/ui-core/src/workflows/` — the Orchestration Layer; owns `try/catch` for graceful degradation.
- Formatting output or defining a CLI command → `artifacts/cli/src/commands/` — the Presentation Layer; parses args, injects `docuviaMemory` config, calls `docuviaApi`, prints results.

**Design spirit** ([Design Spirit & Core Principles](docs/gitbook/guidelines/design-spirit.md)):

- **Protocol-Oriented Programming** — define the contract in `lib/contracts` before the implementation; depend on abstractions, not concretions; compose small interfaces instead of building inheritance hierarchies.
- **Extreme SRP** — one reason to change per module. A file whose purpose needs the word "and" violates SRP and must be decomposed.
- **DRY & bounded complexity** — extract repeated logic; split methods with high cyclomatic complexity; centralize constants/statuses into `constants/` files or typed `enum`/`as const` objects (no magic strings).
- **Defensive & immutable by default** — validate at system boundaries (Zod), never mutate inputs (return new objects), use optional chaining/nullish coalescing, never swallow exceptions in an empty `catch`.

**Naming**: files kebab-case (`ast-parser.ts`); interfaces `I`-prefixed and live only in `lib/contracts` (`IDatabase`); classes PascalCase (`SqliteDatabaseProvider`); functions camelCase (`calculateBlastRadius`).

**Testing placement** (colocated with the code under test, but nature depends on layer):

- `lib/ui-core/**/*.unit.test.ts` — mock injections only, no disk I/O, extremely fast.
- `lib/core/**/*.unit.test.ts` — pure logic, in-memory data transformations.
- `lib/schema/**/*.integration.test.ts` — real (temporary/in-memory) database instance.
- `artifacts/cli/**/*.e2e.test.ts` — spawns a real child process, asserts stdout/stderr.

**Commands** — exactly what CI (`.github/workflows/ci.yml`) and the Husky `pre-commit`/`pre-push` hooks run; run them locally before pushing:

```bash
pnpm run typecheck   # tsc --build, all packages
pnpm run lint        # eslint . (complexity budget included)
pnpm run build       # typecheck + build all packages
pnpm run test        # vitest run --coverage
pnpm run format      # prettier --write .
```

## 📚 Documentation

Full docs live in `docs/gitbook/` — [table of contents](docs/gitbook/SUMMARY.md). Before modifying or creating any core mechanism, you MUST read the corresponding architecture document to ensure implementation consistency:

- [The Virtual Contracts Architecture](docs/gitbook/architecture/virtual-contracts-architecture.md)
- [Application Lifecycle & State Management](docs/gitbook/architecture/application-lifecycle-and-state.md)
- [Unified Error Handling Strategy](docs/gitbook/architecture/error-handling-architecture.md)
- [Event-Driven Logging](docs/gitbook/architecture/logging-architecture.md)
- [Testing & Quality Gates](docs/gitbook/architecture/testing-and-quality-architecture.md)
- [IPC Logging Architecture](docs/gitbook/architecture/ipc-logging-architecture.md) — required before touching `worker_threads`/`child_process` code (e.g. `lib/core/src/ast/`)
- [CLI Commands](docs/gitbook/user-guide/cli.md) — one page per command under `user-guide/cli/`
- [Architecture Decision Records](docs/gitbook/adr/README.md) — the historical _why_, organized by domain (`graph`, `impact`, `interface`, `legacy`, `llm`, `platform`, `retrieval`, `storage`)
- [Roadmap & Open Items](docs/gitbook/analysis/roadmap-and-open-items.md)

## 🧭 Docuvia-First Development Workflow (Mandatory)

Docuvia2 is self-hosted: its own knowledge graph is the primary tool for understanding itself, for both human and AI contributors. `Grep`, `Glob`, and `Read` are the most expensive tools available to an agent working in this repo — each one scans or loads raw files with no structural awareness. Query the graph first; only fall back to raw file exploration when the graph can't answer the question.

**Before exploring the codebase**, query the local knowledge graph instead of grepping/globbing/reading blind:

```bash
npx --no-install docuvia query "<concept_or_file>" --format=prompt
```

**Before editing a symbol or file**, check its blast radius so you know who depends on it:

```bash
npx --no-install docuvia impact <symbolOrFile>
```

**Before finishing a change**, check what it puts at risk against the base branch:

```bash
npx --no-install docuvia review <baseRef>
```

Only fall back to `Grep`/`Glob`/`Read` when:

- `query`/`impact` returns empty, or the target is flagged `tier_b_status="unprocessed"` — the graph hasn't seen it yet, which means _unknown_, not _zero_. Run `docuvia analyze --escalate-to-lsp --full` (or check `docuvia doctor`) before trusting an empty result.
- you need exact source text, formatting, or a diff — the graph indexes structure (nodes/edges), not literal file contents.
- the dependency is one `impact` doesn't detect: a plugin path built from a runtime variable, `import()` with a computed specifier, or `child_process` spawning another project file. See [`impact`'s "What counts as a dependency edge"](docs/gitbook/user-guide/cli/impact.md#what-counts-as-a-dependency-edge).

The block below is the platform-agnostic version of this mandate, kept in sync across `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md` by `docuvia init`'s template (`artifacts/cli/src/constants/init-templates.ts`) — edit the template, not just one copy, if you change the wording.

<!-- docuvia:start -->

# Docuvia — Codebase Knowledge Evolver

This project uses Docuvia to manage architectural context and prevent blast-radius regressions.
Grep/Glob/Read are the most expensive tools available to you — before reaching for them to explore the codebase, query the local knowledge graph instead, and before editing a symbol or file, check its blast radius:

Run: `npx --no-install docuvia query "<concept_or_file>" --format=prompt`
Run: `npx --no-install docuvia impact <symbolOrFile>`

Use the results to understand architectural boundaries, historical decisions, and potential blast radius before modifying code. Only fall back to Grep/Glob/Read when the graph returns nothing, the target is flagged `tier_b_status="unprocessed"` (unknown, not zero), or you need exact source text/formatting a structural query can't capture.
<!-- docuvia:end -->
