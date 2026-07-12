# `docuvia init`

The `init` command initializes a Docuvia workspace in the current directory. It sets up the local SQLite database, configures prompt templates, and prepares the repository for AST analysis.

## Usage

```bash
docuvia init
```

### Flags

- `--platform=<slug1,slug2,...>`: Non-interactively pick which AI agent integrations to install. Available slugs: `cursor`, `claude`, `markdown`. Omit this flag to get the old behavior — an interactive checkbox (all pre-checked) when run in a TTY, or every platform installed when run headless (CI, scripts, AI agents).
- `--global`: Allow registering Docuvia's MCP server in the machine-global Claude Desktop config, instead of just the repo-scoped hooks. Defaults to off; in a TTY you're asked to confirm instead.

## Under the Hood

When you run `docuvia init`:

1. **TTY-aware, not flag-gated**: There's no `--interactive` flag — `init` prompts for confirmation and platform selection when stdin is a TTY, and runs straight through with sensible defaults (confirm=yes, all platforms) when it isn't.
2. **Workspace Scaffold**: Creates the `.docuvia/` directory and initializes `local.db`.
3. **AST Indexing**: Parses the repository and populates the local knowledge graph, reporting any files that failed to parse.
4. **Agent Integrations**: Installs hooks/rules/MCP config for the selected platforms (`--platform=`, or the checkbox/all-platforms default described above).
5. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/init.log`.

## Examples

Interactive initialization (safest):

```bash
docuvia init
```

Headless initialization, only installing Claude integrations:

```bash
docuvia init --platform=claude
```

Headless initialization, explicitly allowing global MCP registration:

```bash
docuvia init --global
```
