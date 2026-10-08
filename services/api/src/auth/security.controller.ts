import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from "@nestjs/common";
import type { SecurityStatus, SessionsResponse } from "@repo/types";
import {
  changePasswordSchema,
  reauthenticateSchema,
  type ChangePasswordInput,
  type ReauthenticateInput,
} from "@repo/validation";
import type { Request, Response } from "express";
import { ApiError } from "../common/api-error.ts";
import { clientInfo } from "../common/client-info.ts";
import { ZodValidationPipe } from "../common/zod-validation.pipe.ts";
import { AccountSecurityService } from "./account-security.service.ts";
import { Authenticated, CurrentAuth } from "./auth.guard.ts";
import { type AuthContext } from "./session.service.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Signed-in security: status, reauthentication, password change and device sessions. */
@Controller("auth")
@Authenticated()
export class SecurityController {
  constructor(private readonly security: AccountSecurityService) {}

  @Get("security")
  status(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<SecurityStatus> {
    res.setHeader("Cache-Control", "no-store");
    return this.security.status(auth);
  }

  /** Password reauthentication. The result is stored on the server's session row, never trusted from the client. */
  @Post("reauthenticate")
  @HttpCode(HttpStatus.NO_CONTENT)
  reauthenticate(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(reauthenticateSchema)) body: ReauthenticateInput,
    @Req() req: Request,
  ): Promise<void> {
    return this.security.reauthenticate(auth, body, clientInfo(req));
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: "password_changed"; revokedSessions: number }> {
    res.setHeader("Cache-Control", "no-store");
    const { revokedSessions } = await this.security.changePassword(auth, body, clientInfo(req));
    return { status: "password_changed", revokedSessions };
  }

  @Get("sessions")
  async sessions(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<SessionsResponse> {
    res.setHeader("Cache-Control", "no-store");
    return { sessions: await this.security.listSessions(auth) };
  }

  // Declared before the `:sessionId` route so "revoke-others" is never read as an id.
  @Post("sessions/revoke-others")
  @HttpCode(HttpStatus.OK)
  revokeOthers(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<{ revoked: number }> {
    return this.security.revokeOtherSessions(auth, clientInfo(req));
  }

  @Post("sessions/:sessionId/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentAuth() auth: AuthContext, @Param("sessionId") sessionId: string, @Req() req: Request): Promise<void> {
    if (!UUID.test(sessionId)) throw new ApiError(HttpStatus.NOT_FOUND, "NOT_FOUND", "Session not found");
    return this.security.revokeSession(auth, sessionId, clientInfo(req));
  }
}
