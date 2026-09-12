import { LogLevels, type LogLevel } from "./types.js";

/** Discriminant tag identifying an `IIpcLogMessage` on a shared `postMessage`/`process.send` channel. */
export const IpcLogMessageType = "ipc-log" as const;

/**
 * The wire shape an `IpcLoggerClient` sends across a `postMessage`/`process.send` boundary —
 * see docs/gitbook/architecture/ipc-logging-architecture.md. No `uuid`/scoping field: the
 * main-thread component that spawned the isolated context already holds the correct per-request
 * `ILogger` (received via Factory params, per the Type-Safe Registry), so routing is a direct
 * forward, not a `docuviaMemory` lookup.
 */
export interface IIpcLogMessage {
  type: typeof IpcLogMessageType;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

const VALID_LOG_LEVELS = new Set<LogLevel>(Object.values(LogLevels));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows an arbitrary `postMessage`/`process.send` payload to an `IIpcLogMessage` only when the
 * complete wire contract is valid. Tagged-but-malformed payloads must not reach `IpcLogRouter`,
 * because an invalid `level` would otherwise become a dynamic method lookup on `ILogger`.
 */
export function isIpcLogMessage(value: unknown): value is IIpcLogMessage {
  if (!isRecord(value)) return false;

  const { type, level, message, context } = value;
  return (
    type === IpcLogMessageType &&
    typeof level === "string" &&
    VALID_LOG_LEVELS.has(level as LogLevel) &&
    typeof message === "string" &&
    (context === undefined || isRecord(context))
  );
}
