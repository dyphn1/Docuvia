import { ENCODING_UTF_8, UTF8_ENCODING } from "@workspace/core";
import { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { logger } from "@workspace/core";
import { API_MESSAGES } from "@workspace/core";
import {
  AUTH_BEARER_PREFIX,
  AUTH_BEARER_PREFIX_LEN,
  DEFAULT_USER_ID,
  ENV_API_KEY,
} from "../constants/index.js";

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env[ENV_API_KEY];

  if (!expectedToken) {
    logger.error(`[Auth] ${API_MESSAGES.AUTH_MISSING_ENV(ENV_API_KEY)}`);
    res.status(500).json({ error: API_MESSAGES.SERVER_CONFIGURATION_ERROR });
    return;
  }

  if (!authHeader || !authHeader.startsWith(AUTH_BEARER_PREFIX)) {
    logger.warn({ ip: req.ip }, "[Auth] Missing or malformed Authorization header");
    res.status(401).json({ error: API_MESSAGES.UNAUTHORIZED });
    return;
  }

  const providedToken = authHeader.substring(AUTH_BEARER_PREFIX_LEN);

  if (
    Buffer.byteLength(providedToken, UTF8_ENCODING) !==
      Buffer.byteLength(expectedToken, UTF8_ENCODING) ||
    !crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(expectedToken))
  ) {
    logger.warn({ ip: req.ip }, "[Auth] Unauthorized access attempt");
    res.status(401).json({ error: API_MESSAGES.UNAUTHORIZED });
    return;
  }

  // Single-tenant limitation: there is no users/api_keys table yet, so every holder of the
  // one shared DOCUVIA_API_KEY resolves to the same identity. Downstream `ownerId !== userId`
  // checks are real but inert until per-key user resolution exists — see crosscutting-concepts.md
  // §8.4 "Single-Tenant Auth (Current Limitation)". Do not rely on this id for isolating distinct users.
  (req as any).user = { id: DEFAULT_USER_ID };

  next();
}
