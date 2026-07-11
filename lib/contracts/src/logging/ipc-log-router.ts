import type { ILogger } from "./types.js";
import { isIpcLogMessage, type IIpcLogMessage } from "./ipc-log-message.js";

/**
 * Main-thread counterpart to `IpcLoggerClient` — see
 * docs/gitbook/guidelines/playbook-ipc-logging.md. The component that spawned the worker
 * already holds the real, per-request `ILogger` (received via Factory params), so routing is a
 * direct forward: no `docuviaMemory` lookup, no UUID.
 */
export class IpcLogRouter {
  constructor(private readonly logger: ILogger) {}

  /**
   * Feed every message received from the worker/child process through this. Non-`ipc-log`
   * messages (e.g. task results) are ignored. Doubles as a type guard, so callers narrow their
   * own union type for free: `if (router.handleMessage(msg)) return; // msg is now the
   * remaining, non-log branch of the union`.
   */
  handleMessage(message: unknown): message is IIpcLogMessage {
    if (!isIpcLogMessage(message)) return false;
    this.logger[message.level](message.message, message.context);
    return true;
  }
}
