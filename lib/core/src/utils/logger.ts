import { pino } from "pino";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const isProduction = process.env.NODE_ENV === "production";
const wantsPretty = process.env.DOCUVIA_PRETTY_LOGS === "1";

function buildTransport() {
  if (!wantsPretty) return undefined;
  try {
    // Resolve eagerly so a broken/unresolvable pino-pretty fails fast into the catch
    // below instead of surfacing asynchronously from inside pino's worker thread.
    require.resolve("pino-pretty");
    return { target: "pino-pretty", options: { colorize: true } };
  } catch {
    console.warn("[docuvia] pino-pretty unavailable, falling back to plain JSON logs.");
    return undefined;
  }
}

// Max's Rule: Strict, environment-agnostic redaction pipeline to prevent PII and Auth Token leakage
export const logger = pino({
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
  transport: buildTransport(),
});
