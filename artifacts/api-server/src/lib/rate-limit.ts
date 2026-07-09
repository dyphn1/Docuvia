import rateLimit from "express-rate-limit";
import { logger } from "@workspace/core";
import { API_MESSAGES } from "@workspace/core";
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_STANDARD_MAX,
  RATE_LIMIT_MCP_MAX,
} from "../constants/index.js";

function logRateLimit(req: import("express").Request) {
  logger.warn({ ip: req.ip, path: req.path }, "Rate limit exceeded");
}

// Rate limiting for standard API endpoints (prevent abuse)
export const standardLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_STANDARD_MAX,
  message: { error: API_MESSAGES.STANDARD_RATE_LIMIT_MESSAGE },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res, _next, options) => {
    logRateLimit(req);
    res.status(options.statusCode).json(options.message);
  },
});

// Stricter rate limiting for MCP / LLM-heavy endpoints (cost prevention)
export const mcpLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MCP_MAX,
  message: { error: API_MESSAGES.MCP_RATE_LIMIT_MESSAGE },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    logRateLimit(req);
    res.status(options.statusCode).json(options.message);
  },
});
