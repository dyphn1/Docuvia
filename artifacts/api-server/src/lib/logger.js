import { pino } from "pino";
const isProduction = process.env.NODE_ENV === "production";
// Max's Rule: Strict, environment-agnostic redaction pipeline to prevent PII and Auth Token leakage
export const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    redact: {
        paths: ['req.headers.authorization', 'password', 'token', 'authorization', 'apiKey'],
        censor: '[REDACTED]'
    },
    transport: process.env.NODE_ENV !== "production"
        ? {
            target: "pino-pretty",
            options: {
                colorize: true,
            },
        }
        : undefined,
});
