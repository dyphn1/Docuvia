import type { ILogger, LogEvent, LogLevel } from "./types.js";

/**
 * Pure event-emitting `ILogger` implementation — the base class every layer shares (see
 * "Exception to Zero-Logic" in docs/gitbook/architecture/logging-architecture.md: `contracts`
 * is allowed to provide this one concrete class so all layers speak the same event bus).
 *
 * Carries no transport, no formatting, no third-party logging dependency (e.g. pino) — those
 * are exclusively the Presentation layer's concern, wired up by attaching an `onLog` listener.
 */
export class Logger implements ILogger {
  private readonly listeners = new Set<(event: LogEvent) => void>();

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit("error", message, context);
  }

  /** Registers a listener; returns an unsubscribe function. */
  onLog(listener: (event: LogEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const event: LogEvent = context
      ? { level, message, context }
      : { level, message };
    for (const listener of this.listeners) listener(event);
  }
}

/** A logger with zero listeners attached — every event is dropped. Safe default for call sites that receive no injected logger (e.g. constructing a service outside of a full workflow, in a test). */
export function createNoopLogger(): ILogger {
  return new Logger();
}
