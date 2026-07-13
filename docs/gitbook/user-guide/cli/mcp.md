# `docuvia mcp`

The `mcp` command starts the Docuvia Model Context Protocol (MCP) server over standard input/output (`stdio`). This allows AI IDEs (like Cursor, Windsurf) and AI Desktop clients (like Claude Desktop) to natively interact with the Docuvia knowledge graph.

## Usage

```bash
docuvia mcp
```

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
