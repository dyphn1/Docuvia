import { LogLevels } from "./types.js";
import type { ILogger } from "./types.js";
import { IpcLogMessageType } from "./ipc-log-message.js";
import type { IIpcLogMessage } from "./ipc-log-message.js";

/**
 * `ILogger` implementation for isolated contexts (`worker_threads`, `child_process`) — see
 * docs/gitbook/guidelines/playbook-ipc-logging.md. A live `ILogger` (or its callback closures)
 * cannot cross a `postMessage`/`process.send` boundary (functions are unclonable), so this
 * serializes every call into an `IIpcLogMessage` and hands it to whatever transport function
 * the caller supplied. The worker code itself only ever sees the standard `ILogger` interface —
 * it never needs to know it's running isolated.
 */
export class IpcLoggerClient implements ILogger {
  constructor(
    private readonly postMessageFn: (message: IIpcLogMessage) => void,
  ) {}

  debug(message: string, context?: Record<string, unknown>): void {
    this.send(LogLevels.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.send(LogLevels.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.send(LogLevels.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.send(LogLevels.ERROR, message, context);
  }

  /** An isolated context has no listeners of its own to register — logs only ever flow outward through `postMessageFn`. Returns a no-op unsubscribe for interface conformance. */
  onLog(): () => void {
    return () => {};
  }

  private send(
    level: IIpcLogMessage["level"],
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const payload: IIpcLogMessage = context
      ? { type: IpcLogMessageType, level, message, context }
      : { type: IpcLogMessageType, level, message };
    this.postMessageFn(payload);
  }
}
