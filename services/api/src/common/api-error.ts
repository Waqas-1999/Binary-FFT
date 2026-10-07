import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiErrorCode } from "@repo/types";

/** An HTTP error with a stable, machine-readable `code` for clients. */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: ApiErrorCode, message: string) {
    super({ code, message }, status);
  }
}

export class RateLimitedException extends ApiError {
  constructor(readonly retryAfterSeconds: number) {
    super(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Too many attempts. Please try again later.");
  }
}
