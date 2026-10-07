import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiError } from "../common/api-error.ts";
import { type AuthContext, SessionService } from "./session.service.ts";

type AuthenticatedRequest = Request & { auth?: AuthContext };

/** Requires a valid session cookie. Prefer the `@Authenticated()` decorator. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.sessions.readToken(req);
    const auth = token ? await this.sessions.authenticate(token) : null;
    if (!auth) throw new ApiError(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Authentication required");

    req.auth = auth;
    return true;
  }
}

/** Marks a controller or route as requiring a signed-in user. */
export const Authenticated = () => applyDecorators(UseGuards(AuthGuard));

/** Injects the `AuthContext` of the signed-in user. Only valid on `@Authenticated()` routes. */
export const CurrentAuth = createParamDecorator((_: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
  if (!auth) throw new Error("@CurrentAuth() used on a route without @Authenticated()");
  return auth;
});
