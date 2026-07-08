# docuvia-mcp(1)

## NAME

docuvia-mcp - Start the local Model Context Protocol (MCP) stdio server

## SYNOPSIS

`docuvia mcp`

## DESCRIPTION

The `docuvia mcp` command launches the background process that communicates over Standard Input/Output (`stdio`) using the Model Context Protocol (MCP).

**This command is designed for machine-to-machine communication.** It is not meant to be run manually by a human in an interactive terminal. Instead, AI IDEs (like Cursor) or AI agents (like Claude Code) spawn this process invisibly in the background.

Once running, it exposes a suite of MCP tools directly to the LLM, empowering the agent with a local, zero-latency query engine for code exploration and impact analysis.

## EXPOSED TOOLS

When attached to an LLM, the following MCP capabilities become available:

- `query_graph`: Equivalent to `docuvia query`.
- `detect_changes`: Equivalent to `docuvia review`.
- `extract_file_knowledge`: Equivalent to `docuvia analyze [path]`.

## OPTIONS

This command currently takes no options.

## ENVIRONMENT VARIABLES

`DOCUVIA_DEBUG_MCP`
: If set, logs MCP transport envelopes to a sidecar file for debugging the JSON-RPC traffic between the IDE and the Docuvia server.

## EXIT STATUS

This command runs continuously until receiving an EOF on `stdin` or a `SIGTERM`/`SIGINT`.

**0**
Success. The server gracefully terminated upon client disconnection.

**1**
Failure. The server crashed due to malformed IPC messages, database locking errors, or uncaught exceptions.

## EXAMPLES

_(For illustration only. Do not type this manually.)_

```bash
$ docuvia mcp
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

## SEE ALSO

- [docuvia-init-agent(1)](init-agent.md) - Automate the configuration to spawn this server.
- [docuvia-query(1)](query.md) - The CLI equivalent for human-readable queries.
