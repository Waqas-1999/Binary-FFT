import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { SessionResponse } from "@repo/types";
import {
  loginSchema,
  resendVerificationSchema,
  signupSchema,
  verifyEmailSchema,
  type LoginInput,
  type ResendVerificationInput,
  type SignupInput,
  type VerifyEmailInput,
} from "@repo/validation";
import type { Request, Response } from "express";
import { clientInfo } from "../common/client-info.ts";
import { ZodValidationPipe } from "../common/zod-validation.pipe.ts";
import { Authenticated, CurrentAuth } from "./auth.guard.ts";
import { AuthService, type NewSession } from "./auth.service.ts";
import { type AuthContext, SessionService } from "./session.service.ts";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post("signup")
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: SignupInput,
    @Req() req: Request,
  ): Promise<{ status: "verification_pending" }> {
    await this.auth.signup(body, clientInfo(req));
    return { status: "verification_pending" };
  }

  @Post("verification/resend")
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(
    @Body(new ZodValidationPipe(resendVerificationSchema)) body: ResendVerificationInput,
    @Req() req: Request,
  ): Promise<{ status: "verification_pending" }> {
    await this.auth.resendVerification(body.email, clientInfo(req));
    return { status: "verification_pending" };
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.signIn(res, await this.auth.verifyEmail(body.token, clientInfo(req)));
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.signIn(res, await this.auth.login(body, clientInfo(req)));
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(this.sessions.readToken(req), clientInfo(req));
    this.sessions.clearCookie(res);
  }

  @Get("session")
  @Authenticated()
  async session(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<SessionResponse> {
    res.setHeader("Cache-Control", "no-store");
    return { user: await this.auth.getUser(auth.userId) };
  }

  private signIn(res: Response, session: NewSession): SessionResponse {
    this.sessions.setCookie(res, session.token, session.expiresAt);
    res.setHeader("Cache-Control", "no-store");
    return { user: session.user };
  }
}
