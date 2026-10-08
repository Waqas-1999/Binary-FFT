import { Logger } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { requestPath } from "./client-info.ts";

const REQUEST_ID_HEADER = "x-request-id";
const VALID_REQUEST_ID = /^[\w-]{1,128}$/;

/** Assigns a request id (reusing a safe incoming one) and logs one structured line per request. */
export function requestLogger() {
  const logger = new Logger("HTTP");

  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const startedAt = performance.now();
    res.on("finish", () => {
      logger.log(`${req.method} ${requestPath(req)} ${res.statusCode}`, {
        requestId,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  };
}
