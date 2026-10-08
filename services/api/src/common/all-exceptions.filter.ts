import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ApiErrorCode, ApiErrorResponse, ValidationIssue } from "@repo/types";
import type { Request, Response } from "express";
import { STATUS_CODES } from "node:http";
import { RateLimitedException } from "./api-error.ts";
import { requestPath } from "./client-info.ts";

const defaultCodes: Partial<Record<number, ApiErrorCode>> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

/** Converts every thrown value into an `ApiErrorResponse`, hiding internal details of unexpected errors. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = String(res.locals.requestId ?? "");

    const isHttp = exception instanceof HttpException;
    const statusCode = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const { message, issues, code } = isHttp
      ? describeHttpException(exception)
      : { message: "Internal server error", issues: undefined, code: undefined };

    if (statusCode >= 500) {
      this.logger.error(`${req.method} ${requestPath(req)} failed`, exception instanceof Error ? exception.stack : exception, {
        requestId,
      });
    }
    if (exception instanceof RateLimitedException) {
      res.setHeader("Retry-After", String(exception.retryAfterSeconds));
    }

    const body: ApiErrorResponse = {
      statusCode,
      code: code ?? defaultCodes[statusCode] ?? "INTERNAL_ERROR",
      error: STATUS_CODES[statusCode] ?? "Error",
      message,
      ...(issues && { issues }),
      path: requestPath(req),
      requestId,
      timestamp: new Date().toISOString(),
    };
    res.status(statusCode).json(body);
  }
}

function describeHttpException(exception: HttpException): {
  message: string;
  issues?: ValidationIssue[];
  code?: ApiErrorCode;
} {
  const response = exception.getResponse();
  if (typeof response === "string") return { message: response };

  const { message, issues, code } = response as {
    message?: string | string[];
    issues?: ValidationIssue[];
    code?: ApiErrorCode;
  };
  return {
    message: Array.isArray(message) ? message.join("; ") : (message ?? exception.message),
    issues,
    code,
  };
}
