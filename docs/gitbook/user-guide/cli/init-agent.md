# docuvia-init-agent(1)

## NAME

docuvia-init-agent - Install AI IDE/Agent hooks for seamless MCP integration

## SYNOPSIS

`docuvia init-agent`

## DESCRIPTION

The `docuvia init-agent` command configures your current workspace and local machine for AI integration. It scans your environment for active AI tools (such as Cursor, Windsurf, or Claude Code) and automatically installs the required Model Context Protocol (MCP) server configurations.

By modifying files like `.cursor/mcp.json` or the global `claude_desktop_config.json`, this command ensures that your AI agents can natively interact with the `docuvia mcp` server without requiring manual JSON editing.

This command is typically invoked automatically during `docuvia init`, but can be run independently if you install a new AI tool and need to re-link the Docuvia graph to it.

## INTERNAL BEHAVIOR

1. **Detection Phase**: Scans known filesystem paths (e.g., `~/.cursor/mcp.json`, `~/.config/claude/claude_desktop_config.json`) to determine which AI tools are installed on the host OS.
2. **Injection Phase**: Reads the target JSON configurations, appends the `docuvia-mcp` server entry pointing to the local CLI binary, and safely rewrites the JSON without destroying existing user configurations.

## OPTIONS

This command currently takes no options.

## EXIT STATUS

**0**
Success. Hooks were successfully installed or updated.

**1**
Failure. Could not write to the necessary configuration directories due to permission errors or malformed target JSON files.

## EXAMPLES

Install hooks for newly downloaded AI IDEs:

```bash
$ docuvia init-agent
✔ Detected Cursor IDE
✔ Added docuvia-mcp to .cursor/mcp.json
✔ Detected Claude Code global configuration
✔ Appended docuvia-stdio server to Claude config
✔ Agents are now fully connected to the knowledge graph!
```

## SEE ALSO

- [docuvia-init(1)](init.md) - Initialize the full project, which includes this step.
- [docuvia-mcp(1)](mcp.md) - The server that the installed hooks will communicate with.
