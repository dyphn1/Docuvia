# docuvia-init(1)

## NAME

docuvia-init - Initialize a new local Docuvia project and index database

## SYNOPSIS

`docuvia init`

## DESCRIPTION

The `docuvia init` command is the foundational step for integrating Docuvia into a repository. It bootstraps the necessary local configuration and state structures required to construct and persist an Abstract Syntax Tree (AST) and Semantic knowledge graph.

When invoked, the command performs the following operations:

1. **Workspace Root Detection**: Identifies the current working directory as the workspace root. It recursively checks parent directories if invoked from a subdirectory.
2. **Directory Creation**: Creates a hidden `.docuvia` configuration directory at the root of the workspace. This directory is typically ignored by version control (`.gitignore`).
3. **Database Initialization**: Scaffolds a local SQLite database (`.docuvia/local.db`) with the Drizzle ORM schemas.
4. **Agent Hook Installation**: Seamlessly modifies AI agent configurations (e.g., `.cursor/mcp.json` or Claude Desktop `claude_desktop_config.json`) to attach the local Model Context Protocol (MCP) server.
5. **Git Hooks Integration**: Prepares the repository to hook into the Git lifecycle (e.g., `post-commit`) to keep the knowledge graph synchronized automatically with branch changes.

Running `docuvia init` in an already initialized repository is safe. It will not destroy an existing `.docuvia/local.db` but will verify that the schema is up to date and re-apply any missing hooks or MCP configurations.

## OPTIONS

This command currently takes no explicit options from the command line.

## ENVIRONMENT VARIABLES

`DOCUVIA_HOME`
: (Optional) Overrides the default location for global Docuvia configuration. However, `init` primarily acts on the current working directory.

`DEBUG`
: If set to `docuvia:*`, enables verbose logging during the initialization phase, detailing exact file paths being written and database migrations being applied.

## CONFIGURATION

The `init` command writes its baseline configuration to `.docuvia/config.json`. This file dictates default behaviors for subsequent commands like `analyze` and `sync`.

## EXIT STATUS

**0**
Success. The repository is successfully initialized.

**1**
Failure. Initialization aborted due to insufficient permissions or unexpected filesystem errors (e.g., unable to create the SQLite file).

## EXAMPLES

Initialize Docuvia in a newly cloned legacy repository:

```bash
$ cd firmware-project
$ docuvia init
✔ Initialized .docuvia configuration directory
✔ Local SQLite database created successfully
✔ Detected Cursor IDE
✔ Added docuvia-mcp to .cursor/mcp.json
```

## SEE ALSO

- [docuvia-analyze(1)](analyze.md) - Populate the initialized database with AST extractions.
- [docuvia-clean(1)](clean.md) - Wipe the initialized database to start fresh.
