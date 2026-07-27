# Docuvia2

> Universal VCS Knowledge Graph Engine

Docuvia2 is the next-generation, simplified, and highly modular iteration of the Docuvia knowledge graph engine. It ingests Git history, documents, and code to construct a queryable knowledge graph, exposing it to AI agents via CLI and MCP.

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

## Environment Requirements

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

3. **(Optional) Install LSP servers for the languages you work in** — use the Install Command column above. TypeScript/Python/PHP servers are npm-distributed; installing them as project `devDependencies` (as shown) is the most reliable option, since Docuvia also falls back to `npx --no-install` when no local copy is found. Go/Rust/Java/C++/C#/Ruby servers are native binaries resolved from `PATH` first, then a set of well-known per-toolchain install directories (e.g. `~/go/bin`, `~/.cargo/bin`, `~/.dotnet/tools`) as a fail-safe, so a fresh shell that hasn't picked up `PATH` yet still finds them.

4. **Verify your setup**

   ```bash
   npx docuvia doctor
   ```

   `doctor` reports whether each installed language server actually resolves, without requiring a full `analyze --escalate-to-lsp` run first.

## Documentation

The complete documentation, including the critical system architecture and design principles, is available in the `docs/gitbook/` directory.

- [Prologue: Vision & Goal](docs/gitbook/README.md)
- [System Architecture Guide](docs/gitbook/architecture/README.md)
  - [The Virtual Contracts Architecture](docs/gitbook/architecture/virtual-contracts-architecture.md)
  - [Application Lifecycle & State Management](docs/gitbook/architecture/application-lifecycle-and-state.md)
  - [Unified Error Handling Strategy](docs/gitbook/architecture/error-handling-architecture.md)
  - [Event-Driven Logging Architecture](docs/gitbook/architecture/logging-architecture.md)
  - [Strict Testing & Quality Gates](docs/gitbook/architecture/testing-and-quality-architecture.md)

## For AI Agents and Developers

Before contributing, please read [AGENTS.md](AGENTS.md) carefully to understand the strict architectural constraints of this repository.
