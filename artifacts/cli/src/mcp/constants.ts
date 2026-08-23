import { getPackageVersion } from "../utils/package-version.js";

export const MCP_SERVER_NAME = "docuvia-local-mcp";
/** Mirrors the CLI's `--version` source so the MCP handshake always reports the shipped version. */
export const MCP_SERVER_VERSION = getPackageVersion();

/** Sent during the MCP initialize handshake (issue #190) — the agent-invocation-rate lever:
 *  clients surface these instructions to the model, so this is where the Docuvia-First workflow
 *  gets advertised at connection time, not just via per-tool descriptions. */
export const MCP_SERVER_INSTRUCTIONS = [
  "Docuvia maintains a local knowledge graph of this workspace: modules, dependencies, blast radius, and recorded architectural decisions ('why' rationale).",
  "Workflow:",
  "1. Before exploring code structure with Grep/Glob/Read, call docuvia_query — it returns structural context those tools cannot.",
  "2. Before editing or deleting a symbol/file, call docuvia_impact to see who depends on it.",
  "3. After finishing edits, call docuvia_detect_changes as a pre-commit risk check.",
  "4. If results look empty or suspicious, call docuvia_status — incomplete Tier B coverage means partial answers.",
  "Treat non-'exact' match_type results and 'unprocessed'/incomplete-coverage flags as lower confidence — unknown, not zero; cross-check before relying on them.",
].join("\n");

export const MCP_SERVER_READY_MESSAGE =
  "Docuvia Local MCP Server running on stdio";
export const MCP_TOOL_NOT_FOUND_MESSAGE = (name: string) =>
  `Tool not found: ${name}`;

/** MCP tool response `content[].type` discriminant — the only kind these tools emit today. */
export const MCP_CONTENT_TYPE_TEXT = "text";
