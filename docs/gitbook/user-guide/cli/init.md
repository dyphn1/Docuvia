# `docuvia init`

Initialize a Docuvia workspace in the current directory. Sets up the local SQLite database, configures prompt templates, and prepares the repository for AST analysis.

## Usage

```bash
docuvia init [flags]
```

## Options

_(This command does not accept positional arguments.)_

### Flags

- `--platform=<slug1,slug2,...>`: Non-interactively pick which AI agent integrations to install. Available slugs: `cursor`, `claude`, `copilot`, `codex`, `continue`, `hermes`.
- `--interactive`, `-i`: Opt-in to interactive prompts (wizard menu, confirmations). Required to see the platform selection checkboxes. If both `--platform` and `--interactive` are absent, Docuvia will default to installing every available platform non-interactively.

## Under the Hood

When you run `docuvia init`:

1. **Opt-in Interactivity**: Follows the `IFCE-004` design — does not automatically prompt based on raw TTY detection. Interactive confirmation and checkboxes only trigger when `--interactive` or `-i` is explicitly passed. When run headless or without `--interactive`, it installs all available platforms (or the specific ones passed to `--platform`) non-interactively.
2. **Workspace Scaffold**: Creates the `.docuvia/` directory and initializes `local.db`.
3. **AST Indexing**: Parses the repository and populates the local knowledge graph, reporting any files that failed to parse. Every parsed file is also queued for Tier B (see [`analyze`'s Mode C](analyze.md)), so a later `analyze --escalate-to-lsp` run resolves LSP-precision cross-file edges for this initial parse without needing a follow-up commit first — `init` stays behaviorally identical to `analyze`'s own empty-graph full-ingestion path here.
4. **Agent Integrations**: Installs hooks/rules/MCP config for the selected platforms (`--platform=`, or the checkbox/all-platforms default described above). Each platform owns exactly one target — `cursor`/`claude` write a repo-scoped hooks dir plus MCP config, `copilot` writes `.github/copilot-instructions.md`, `codex` writes `AGENTS.md`, `continue` writes the dedicated `.continue/rules/docuvia.md`, `hermes` writes `.hermes.md` — see [PLAT-008](../../adr/platform/PLAT-008-retire-generic-markdown-for-named-platforms.md) for why the old single "Markdown Agents" bucket was split up. Everything written is repo-scoped ([IFCE-002](../../adr/interface/IFCE-002-strict-repo-scoped-boundaries.md) — no machine-global side effects). For Claude Desktop specifically, `init` prints the `mcpServers` JSON snippet and the machine-global config path instead of writing to it — copy-paste it yourself if you use Claude Desktop.
5. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/init.log`.

## Examples

Interactive initialization (safest, prompt for platform selection):

```bash
docuvia init --interactive
```

Headless initialization, installing all platform integrations non-interactively:

```bash
docuvia init
```

Headless initialization, only installing Claude integrations:

```bash
docuvia init --platform=claude
```

Only installing Codex and Continue integrations:

```bash
docuvia init --platform=codex,continue
```
