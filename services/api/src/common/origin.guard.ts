import { type CanActivate, type ExecutionContext, HttpStatus, SetMetadata } from "@nestjs/common";
import type { Request } from "express";
import { ApiError } from "./api-error.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SKIP_ORIGIN_CHECK = "skipOriginCheck";

/**
 * Exempts one route from the browser-origin check. Only for server-to-server callbacks that carry no
 * cookies and prove who they are another way (e.g. the Telegram webhook's secret header).
 */
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN_CHECK, true);

/**
 * CSRF protection for cookie authentication, together with SameSite=Lax cookies:
 * every state-changing request must come from an allowed origin. Browsers always send
 * `Origin` on cross-origin and same-origin POSTs; `Referer` is the fallback.
 */
export class OriginGuard implements CanActivate {
  constructor(private readonly allowedOrigins: readonly string[]) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (Reflect.getMetadata(SKIP_ORIGIN_CHECK, context.getHandler()) === true) return true;

    if (!this.allowedOrigins.includes(requestOrigin(req) ?? "")) {
      throw new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN_ORIGIN", "Request origin is not allowed");
    }
    return true;
  }
}

function requestOrigin(req: Request): string | undefined {
  const origin = req.header("origin");
  if (origin) return origin;

  const referer = req.header("referer");
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
