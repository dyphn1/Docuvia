export const LogLevels = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
} as const;

/**
 * Every log emitted anywhere in the workspace must conform to this shape — see
 * docs/gitbook/architecture/logging-architecture.md. `context` carries structured data
 * (file paths, counts, durations); it is never string-interpolated into `message`.
 */
export type LogLevel = (typeof LogLevels)[keyof typeof LogLevels];

export interface LogEvent {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * The only logging surface implementation libraries and orchestration are allowed to call.
 * No implementation ever writes to stdout/stderr/disk directly — it emits an event, and the
 * Presentation layer's registered listener decides what happens to it.
 */
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  onLog(listener: (event: LogEvent) => void): () => void;
}
