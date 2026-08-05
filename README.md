# Docuvia2

> Universal VCS Knowledge Graph Engine

Docuvia2 is the next-generation, simplified, and highly modular iteration of the Docuvia knowledge graph engine. It ingests Git history, documents, and code to construct a queryable knowledge graph, exposing it to AI agents via CLI and MCP.

## Vision

Most AI coding agents re-derive the same architectural context on every session — re-reading files, re-grepping for callers, re-guessing why a module is shaped the way it is. That context already exists in the repo: in commit history, in diffs, in design docs, in the code itself. It's just not queryable.

Docuvia mines commit history, diffs, and spec documents alongside static code to surface the **why** behind every decision, not just the **what**, and packages it as a local, structured knowledge graph. The goal is a local-first, always-current source of architectural truth that both engineers and AI agents can query in milliseconds instead of re-exploring the codebase from scratch — see [Prologue: Vision & Goal](docs/gitbook/README.md) for the full write-up.

## Features

- **Local-first knowledge graph** — SQLite-backed, lives next to your code, no cloud daemon or external vector DB required.
- **Two-tier code intelligence** — Tier A: deterministic, multi-language AST parsing (10 languages, see below) that runs on every commit; Tier B: optional LSP escalation for cross-file, call-precision edges.
- **Blast-radius & impact analysis** — `docuvia impact` and `docuvia review` compute who depends on a symbol, file, or changed diff before you touch it, with a color-coded risk level.
- **Agent-ready query API** — `docuvia query` (keyword + structural FTS5 search) and `docuvia mcp` (a local stdio MCP server) expose the graph as structured, prompt-safe `<docuvia_context>` blocks.
- **Self-hosting** — Git hooks keep the graph current automatically (`post-commit` for Tier A, `pre-push` for Tier B) — Docuvia2 builds and verifies itself with its own graph. See [Self-Hosting](#self-hosting-docuvia-analyzes-docuvia) below.
- **Multi-platform agent integration** — one `docuvia init` installs hooks/rules for Claude, Cursor, GitHub Copilot, Codex, Continue, and Hermes in a single pass.

## Supported Languages

AST parsing (Tier A) covers every language below out of the box. LSP escalation (Tier B, `--escalate-to-lsp`) adds cross-file, LSP-precision `calls` edges on top, once its language server is installed and resolvable — see [Environment Setup](#environment-setup).

| Language                | File Extensions                                                         | AST Parsing (Tier A) | LSP Server (Tier B)              | Install Command                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------- | :------------------: | -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| TypeScript / JavaScript | `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`            |          ✅          | `typescript-language-server`     | `npm install -D typescript-language-server typescript`                                                              |
| Python                  | `.py`                                                                   |          ✅          | `pyright` (`pyright-langserver`) | `npm install -D pyright`                                                                                            |
| Go                      | `.go`                                                                   |          ✅          | `gopls`                          | `go install golang.org/x/tools/gopls@latest`                                                                        |
| Rust                    | `.rs`                                                                   |          ✅          | `rust-analyzer`                  | `rustup component add rust-analyzer`                                                                                |
| Java                    | `.java`                                                                 |          ✅          | `jdtls` (Eclipse JDT LS)         | `brew install jdtls` (macOS) / see [download page](https://download.eclipse.org/jdtls/)                             |
| C / C++                 | `.c`, `.h`, `.cpp`, `.cxx`, `.cc`, `.hpp`, `.hxx`, `.hh`, `.cu`, `.cuh` |          ✅          | `clangd`                         | `brew install llvm` (macOS) / `apt install clangd` (Linux) / [LLVM installer](https://releases.llvm.org/) (Windows) |
| C#                      | `.cs`                                                                   |          ✅          | `csharp-ls`                      | `dotnet tool install --global csharp-ls`                                                                            |
| PHP                     | `.php`, `.phtml`, `.php3`, `.php4`, `.php5`, `.phps`                    |          ✅          | `intelephense`                   | `npm install -D intelephense`                                                                                       |
| Ruby                    | `.rb`, `.rake`, `.gemspec`                                              |          ✅          | `ruby-lsp`                       | `gem install ruby-lsp`                                                                                              |

## Installation

### Environment Requirements

| Requirement            | Minimum Version                | Why                                                                                      |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| Node.js                | 20 LTS+                        | Runs the CLI, MCP server, and all TypeScript packages                                    |
| pnpm                   | 9.15.9+ (`packageManager` pin) | Workspace-aware install/build/test across `lib/*`                                        |
| Git                    | 2.30+                          | Powers history ingestion (`libgit2`-backed)                                              |
| Per-language toolchain | See table above                | Only needed for that language's LSP escalation (Tier B); AST parsing needs nothing extra |

### Environment Setup

1. **Install Node.js and pnpm**

   ```bash
   corepack enable
   corepack prepare pnpm@9.15.9 --activate
   ```

2. **Install project dependencies and build**

   ```bash
   pnpm install
   pnpm run build
   ```

   If `docuvia` isn't resolvable afterwards (`npx --no-install docuvia --version` errors), re-run `pnpm install --force` once — this regenerates the workspace's `node_modules/.bin/docuvia` shim, which can go stale after a fresh clone or a Node/pnpm upgrade.

3. **(Optional) Install LSP servers for the languages you work in** — use the Install Command column above. TypeScript/Python/PHP servers are npm-distributed; installing them as project `devDependencies` (as shown) is the most reliable option, since Docuvia also falls back to `npx --no-install` when no local copy is found. Go/Rust/Java/C++/C#/Ruby servers are native binaries resolved from `PATH` first, then a set of well-known per-toolchain install directories (e.g. `~/go/bin`, `~/.cargo/bin`, `~/.dotnet/tools`) as a fail-safe, so a fresh shell that hasn't picked up `PATH` yet still finds them.

4. **Verify your setup**

   ```bash
   npx docuvia doctor
   ```

   `doctor` reports whether each installed language server actually resolves, without requiring a full `analyze --escalate-to-lsp` run first — it now fails (not just informs) when a language you've actually got queued for Tier B isn't ready, so fix that before running `analyze --escalate-to-lsp` for real (or pass `--fallback-ast` to degrade to AST-only precision instead of failing).

## Quick Start

```bash
# 1. Initialize Docuvia in a repo (this repo, or your own) — scaffolds .docuvia/,
#    runs the first AST ingestion, and installs agent integrations for every
#    supported platform (pass --platform=claude,codex,... to pick a subset)
npx docuvia init

# 2. Ask the knowledge graph a question, human-readable
npx docuvia query "AstWorkerPool" --format=human

# 3. Check the blast radius before touching a symbol or file
npx docuvia impact verifyToken

# 4. See what a branch/PR touches and how risky it is
npx docuvia review main

# 5. Inspect graph size / row counts at any time
npx docuvia status
```

Run `npx docuvia <command> --help` for the full flag reference, or see [CLI Commands](docs/gitbook/user-guide/cli.md) in the docs for a command-by-command deep dive (including `mcp`, `snapshot`/`hydrate`, and `export-topology`).

## Documentation

The complete documentation — including the critical system architecture and design principles — lives in the `docs/gitbook/` directory, structured as a GitBook. Start here:

- [Prologue: Vision & Goal](docs/gitbook/README.md)
- [Full Table of Contents](docs/gitbook/SUMMARY.md) — every architecture guide, coding guideline, CLI command reference, ADR, and workflow doc
- [System Architecture Guide](docs/gitbook/architecture/README.md)
  - [The Virtual Contracts Architecture](docs/gitbook/architecture/virtual-contracts-architecture.md)
  - [Application Lifecycle & State Management](docs/gitbook/architecture/application-lifecycle-and-state.md)
  - [Unified Error Handling Strategy](docs/gitbook/architecture/error-handling-architecture.md)
  - [Event-Driven Logging Architecture](docs/gitbook/architecture/logging-architecture.md)
  - [Strict Testing & Quality Gates](docs/gitbook/architecture/testing-and-quality-architecture.md)
- [Coding Guidelines](docs/gitbook/guidelines/README.md) — design spirit, file placement rules, naming conventions
- [User Guide: CLI Commands](docs/gitbook/user-guide/cli.md)
- [Architecture Decision Records](docs/gitbook/adr/README.md)

## Self-Hosting: Docuvia Analyzes Docuvia

Docuvia2 is self-hosted — it uses its own knowledge graph to develop and verify itself, rather than an external code-intelligence tool. Git hooks (installed via Husky) keep the local graph current as you work:

- **`post-commit`**: fires `docuvia analyze` in the background (Tier A — deterministic AST delta, sub-second, never blocks the commit).
- **`pre-push`**: runs `docuvia analyze --escalate-to-lsp --fallback-ast && docuvia snapshot && docuvia sync-knowledge` synchronously (Tier B — LSP-precision cross-file edges), so pushed code always carries corrected knowledge. `--fallback-ast` degrades to AST-only precision instead of failing when the LSP environment isn't ready — a manual `analyze --escalate-to-lsp` (without that flag) fails outright instead, so run `doctor` first. This never blocks the push on failure; see [PLAT-007: Tiered Background Knowledge Evolution](docs/gitbook/adr/platform/PLAT-007-tiered-background-knowledge-evolution.md).

Before exploring the codebase or making structural changes (by hand or via an AI agent), query the local knowledge graph to understand architectural boundaries, historical decisions, and blast radius:

```bash
npx --no-install docuvia query "<concept_or_file>" --format=prompt
```

## For AI Agents and Developers

Before contributing, please read [AGENTS.md](AGENTS.md) carefully to understand the strict architectural constraints of this repository, the project structure, and the mandatory Docuvia-first exploration workflow. It also carries the same Docuvia query instructions above, so agent platforms that load `AGENTS.md` directly (e.g. Codex) pick them up automatically.

## License

Docuvia2 is released under the MIT license (see the `license` field in [package.json](package.json)).
