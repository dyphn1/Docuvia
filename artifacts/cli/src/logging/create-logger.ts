import pino from "pino";
import { createRequire } from "module";
import { Logger, type LogEvent } from "@workspace/contracts";

const require = createRequire(import.meta.url);

/**
 * Every destination writes to stderr (fd 2), never stdout — `docuvia mcp` uses stdout
 * exclusively for the MCP JSON-RPC stream (see `mcp/server.ts`'s own stderr-only ready
 * message), and a stray stdout write from any log level would corrupt that stream.
 */
function buildTransport() {
  const wantsPretty = process.env.DOCUVIA_PRETTY_LOGS === "1";
  if (!wantsPretty) return undefined;
  try {
    // Resolve eagerly so a broken/unresolvable pino-pretty fails fast into the catch
    // below instead of surfacing asynchronously from inside pino's worker thread.
    require.resolve("pino-pretty");
    return {
      target: "pino-pretty",
      options: { colorize: true, destination: 2 },
    };
  } catch {
    process.stderr.write(
      "[docuvia] pino-pretty unavailable, falling back to plain JSON logs.\n",
    );
    return undefined;
  }
}

/**
 * Presentation-layer log sink — see docs/gitbook/architecture/logging-architecture.md. Only
 * this layer reads `process.env` for logging config and owns the pino transport/formatting;
 * every other layer only ever sees the pure `ILogger` interface and emits structured events.
 */
export function createPinoBackedLogger(): Logger {
  const transport = buildTransport();
  const pinoInstance = pino(
    {
      level: process.env.LOG_LEVEL || "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.Authorization",
          "*.authorization",
          "*.Authorization",
          "*.*.authorization",
          "*.*.Authorization",
          "password",
          "*.password",
          "*.*.password",
          "token",
          "*.token",
          "*.*.token",
          "apiKey",
          "*.apiKey",
          "*.*.apiKey",
          "OPENAI_API_KEY",
          "*.OPENAI_API_KEY",
          "*.*.OPENAI_API_KEY",
        ],
        censor: "[REDACTED]",
      },
      transport,
    },
    // No transport -> plain JSON path: write directly to fd 2 (stderr) instead of pino's
    // stdout default.
    transport ? undefined : pino.destination(2),
  );

  const logger = new Logger();
  logger.onLog((event: LogEvent) => {
    pinoInstance[event.level](event.context ?? {}, event.message);
  });
  return logger;
}
