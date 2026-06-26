import { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger";

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.DOCUVIA_API_KEY;

  if (!expectedToken) {
    logger.error("[Auth] DOCUVIA_API_KEY environment variable is not set. Refusing all requests.");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn({ ip: req.ip }, "[Auth] Missing or malformed Authorization header");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const providedToken = authHeader.substring(7);

  if (
    Buffer.byteLength(providedToken, "utf8") !== Buffer.byteLength(expectedToken, "utf8") ||
    !crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(expectedToken))
  ) {
    logger.warn({ ip: req.ip }, "[Auth] Unauthorized access attempt");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  (req as any).user = { id: 1 };

  next();
}
