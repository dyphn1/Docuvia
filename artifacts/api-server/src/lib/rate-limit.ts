import rateLimit from "express-rate-limit";

// Rate limiting for standard API endpoints (prevent abuse)
export const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per windowMs
  message: { error: "Too many requests from this IP, please try again later." },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Stricter rate limiting for MCP / LLM-heavy endpoints (cost prevention)
export const mcpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: "Too many MCP or Search requests. Rate limit exceeded." },
  standardHeaders: true,
  legacyHeaders: false,
});
