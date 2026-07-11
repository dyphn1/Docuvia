import type { LogLevel } from "./types.js";

/**
 * The wire shape an `IpcLoggerClient` sends across a `postMessage`/`process.send` boundary —
 * see docs/gitbook/guidelines/playbook-ipc-logging.md. No `uuid`/scoping field: the main-thread
 * component that spawned the isolated context already holds the correct per-request `ILogger`
 * (received via Factory params, per the Type-Safe Registry), so routing is a direct forward,
 * not a `docuviaMemory` lookup.
 */
export interface IIpcLogMessage {
  type: "ipc-log";
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/** Narrows an arbitrary `postMessage`/`process.send` payload to an `IIpcLogMessage`. */
export function isIpcLogMessage(value: unknown): value is IIpcLogMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "ipc-log"
  );
}
