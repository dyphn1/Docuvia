# `docuvia mcp`

Start the local MCP stdio server to allow AI IDEs (Cursor, Windsurf) or Desktop clients (Claude Desktop) to query the knowledge graph.

## Usage

```bash
docuvia mcp
```

## Options

_(This command does not accept any options, arguments, or flags.)_

## Under the Hood

When you run `docuvia mcp`:

1. **Stdio Server**: The CLI launches an ongoing process that listens to `stdin` and writes to `stdout` following the JSON-RPC MCP specification.
2. **Tool Exposure**: It exposes tools like `query`, `impact`, and `review` directly to the connected LLM.
3. **Service Layer**: The MCP server wraps the identical `@workspace/core` logic as the standard CLI commands, ensuring behavioral parity.

_(Note: Because this is a long-running process, it does NOT write to the one-shot JSONL command logs in `.docuvia/logs/`. It uses standard pino debug logging internally if configured)._

## Configuration

Typically, you do not run this command manually. It is configured as a command in your AI client's MCP configuration:

```json
{
  "mcpServers": {
    "docuvia": {
      "command": "npx",
      "args": ["docuvia", "mcp"]
    }
  }
}
```

## Examples

Start the MCP server manually (for testing stdio):

```bash
docuvia mcp
```

    }

}
}

```

```
