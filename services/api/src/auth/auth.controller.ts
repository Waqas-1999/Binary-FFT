import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { LoginResponse, SessionResponse } from "@repo/types";
import {
  forgotPasswordSchema,
  loginSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type ResendVerificationInput,
  type ResetPasswordInput,
  type SignupInput,
  type VerifyEmailInput,
} from "@repo/validation";
import type { Request, Response } from "express";
import { clientInfo } from "../common/client-info.ts";
import { ZodValidationPipe } from "../common/zod-validation.pipe.ts";
import { Authenticated, CurrentAuth } from "./auth.guard.ts";
import { type AuthResult, AuthService, type NewSession } from "./auth.service.ts";
import { LoginChallengeService } from "./login-challenge.service.ts";
import { type AuthContext, SessionService } from "./session.service.ts";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly challenges: LoginChallengeService,
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
  ): Promise<LoginResponse> {
    return this.respond(res, await this.auth.verifyEmail(body.token, clientInfo(req)));
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    return this.respond(res, await this.auth.login(body, clientInfo(req)));
  }

  /** Always answers the same way, whether or not the address has an account. */
  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
    @Req() req: Request,
  ): Promise<{ status: "reset_pending" }> {
    await this.auth.forgotPassword(body.email, clientInfo(req));
    return { status: "reset_pending" };
  }

  /** Does not sign the user in: every session was revoked, so they sign in again with the new password. */
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: "password_reset" }> {
    await this.auth.resetPassword(body.token, body.password, clientInfo(req));
    this.sessions.clearCookie(res);
    res.setHeader("Cache-Control", "no-store");
    return { status: "password_reset" };
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

  /** A session cookie when sign-in is complete; otherwise a challenge cookie and a "two-factor required" answer. */
  private respond(res: Response, result: AuthResult): LoginResponse {
    res.setHeader("Cache-Control", "no-store");
    if (result.kind === "challenge") {
      this.challenges.setCookie(res, result.token, result.expiresAt);
      return { status: "two_factor_required" };
    }
    return this.signIn(res, result.session);
  }

  private signIn(res: Response, session: NewSession): SessionResponse {
    this.sessions.setCookie(res, session.token, session.expiresAt);
    res.setHeader("Cache-Control", "no-store");
    return { user: session.user };
  }
}
