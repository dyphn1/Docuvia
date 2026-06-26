# 02. Automated MCP Agent Registration

**Severity:** 🔴 CRITICAL
**Domain:** Local MCP Integration
**Target:** `@workspace/cli` (`init-agent` command)

## Deficit Description
Even if we build a local `stdio` MCP server (Issue #01), developers currently have to manually edit their IDE or desktop client configuration files to register it. This causes immense friction and reduces adoption. 

If Docuvia is to act as a seamless "VCS-based Knowledge Evolver", it must wire itself into the AI agents automatically.

## Acceptance Criteria
1. Enhance the `docuvia init-agent` command.
2. For **Claude Desktop**: Automatically detect and inject the `docuvia mcp` command into `~/Library/Application Support/Claude/claude_desktop_config.json` (or OS equivalent).
3. For **Cursor**: Automatically inject the MCP configuration into the workspace's `.cursor/mcp.json`.
4. Ensure the injection logic parses existing JSON safely, appends the Docuvia server, and writes it back without corrupting user configurations.