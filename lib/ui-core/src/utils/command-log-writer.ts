import fs from "fs/promises";
import path from "path";
import {
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
  UTF8_ENCODING,
} from "@workspace/contracts";

/**
 * Shared JSONL run-log writer used by every one-shot CLI command's workflow (`init`, `analyze`,
 * `status`, `clean`, `review`, `sync`, `snapshot`, `query`, `export --topology`). `docuvia mcp`
 * is a long-running stdio server, not a one-shot command, and deliberately does not use this
 * (or any per-invocation log file).
 *
 * Each call appends one JSON object per line — `{ ts, ...event }` — to
 * `.docuvia/logs/<logFileName>`, so a human or AI agent can inspect what a run actually did
 * after the fact instead of trusting a possibly-lost terminal message. This writes a persisted
 * audit trail, not a live log event — deliberately separate from `ILogger`.
 */
export async function appendCommandLogLine(
  workspaceRoot: string,
  logFileName: string,
  event: Record<string, unknown>,
): Promise<void> {
  const logPath = path.join(
    workspaceRoot,
    DOCUVIA_DIR_NAME,
    DOCUVIA_LOGS_DIR_NAME,
    logFileName,
  );
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(
    logPath,
    JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n",
    UTF8_ENCODING,
  );
}
