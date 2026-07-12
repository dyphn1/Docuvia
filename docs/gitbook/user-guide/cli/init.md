# `docuvia init`

The `init` command initializes a Docuvia workspace in the current directory. It sets up the local SQLite database, configures prompt templates, and prepares the repository for AST analysis.

## Usage

```bash
docuvia init
```

### Flags

- `--interactive`: Opt-in to the Wizard-style interactive UI to guide you through the process.

## Under the Hood

When you run `docuvia init`:

1. **Non-Interactive by Default**: Fails fast if required parameters are absent, unless `--interactive` is provided.
2. **Workspace Scaffold**: Creates the `.docuvia/` directory, initializes `local.db`, and creates `logs/`.
3. **Safe Gitignore**: Automatically detects and injects `.docuvia/` into your root `.gitignore` file to ensure the ephemeral SQLite databases and local logs are never committed to your main source tree.
4. **Template Bootstrapping**: Pulls down prompt templates for the VS Code extension or Cursor/Claude based on detected platform environments.
5. **Git Hooks**: Installs a lightweight `post-commit` hook to drive incremental watch.
6. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/init.log`.

## Examples

Interactive initialization (safest):
```bash
docuvia init
```

Headless initialization, explicitly allowing global MCP registration:
```bash
docuvia init --global
```
