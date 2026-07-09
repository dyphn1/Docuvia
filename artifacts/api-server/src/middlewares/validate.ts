import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";
import { API_MESSAGES } from "@workspace/core";

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.locals.validatedBody = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: err.issues[0]?.message ?? API_MESSAGES.INVALID_REQUEST_BODY,
          details: err,
        });
        return;
      }
      next(err);
    }
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      res.locals.validatedQuery = schema.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: err.issues[0]?.message ?? API_MESSAGES.INVALID_QUERY_PARAMETERS,
          details: err,
        });
        return;
      }
      next(err);
    }
  };
}
