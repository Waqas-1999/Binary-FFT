import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ApiErrorResponse, ValidationIssue } from "@repo/types";
import type { Request, Response } from "express";
import { STATUS_CODES } from "node:http";

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
    const { message, issues } = isHttp
      ? describeHttpException(exception)
      : { message: "Internal server error", issues: undefined };

    if (statusCode >= 500) {
      this.logger.error(`${req.method} ${req.originalUrl} failed`, exception instanceof Error ? exception.stack : exception, {
        requestId,
      });
    }

    const body: ApiErrorResponse = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? "Error",
      message,
      ...(issues && { issues }),
      path: req.originalUrl,
      requestId,
      timestamp: new Date().toISOString(),
    };
    res.status(statusCode).json(body);
  }
}

function describeHttpException(exception: HttpException): { message: string; issues?: ValidationIssue[] } {
  const response = exception.getResponse();
  if (typeof response === "string") return { message: response };

  const { message, issues } = response as { message?: string | string[]; issues?: ValidationIssue[] };
  return {
    message: Array.isArray(message) ? message.join("; ") : (message ?? exception.message),
    issues,
  };
}
