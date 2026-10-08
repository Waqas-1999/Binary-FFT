import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { RecoveryCodesResponse, SessionResponse, TwoFactorSetup } from "@repo/types";
import {
  recoveryCodeInputSchema,
  twoFactorCodeInputSchema,
  type z,
} from "@repo/validation";
import type { Request, Response } from "express";
import { ApiError } from "../../common/api-error.ts";
import { clientInfo } from "../../common/client-info.ts";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.ts";
import { AuthService } from "../auth.service.ts";
import { Authenticated, CurrentAuth } from "../auth.guard.ts";
import { LoginChallengeService, type SecondFactor } from "../login-challenge.service.ts";
import { type FirstFactor, LoginSessionService } from "../login-session.service.ts";
import { type AuthContext, SessionService } from "../session.service.ts";
import { TwoFactorService } from "./two-factor.service.ts";

type CodeBody = z.infer<typeof twoFactorCodeInputSchema>;
type RecoveryBody = z.infer<typeof recoveryCodeInputSchema>;

const firstFactors: readonly FirstFactor[] = ["password", "email_verification", "google"];

/** Authenticator-app two-factor: finishing a sign-in (public, challenge cookie) and managing it (signed in). */
@Controller("auth/2fa")
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly challenges: LoginChallengeService,
    private readonly loginSessions: LoginSessionService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  /** Completes a pending sign-in with an authenticator code. */
  @Post("verify")
  @HttpCode(HttpStatus.OK)
  verify(
    @Body(new ZodValidationPipe(twoFactorCodeInputSchema)) body: CodeBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.finishSignIn(req, res, { kind: "totp", code: body.code });
  }

  /** Completes a pending sign-in with a one-time recovery code. */
  @Post("recovery")
  @HttpCode(HttpStatus.OK)
  recovery(
    @Body(new ZodValidationPipe(recoveryCodeInputSchema)) body: RecoveryBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.finishSignIn(req, res, { kind: "recovery", code: body.code });
  }

  @Post("setup")
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  setup(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<TwoFactorSetup> {
    res.setHeader("Cache-Control", "no-store");
    return this.twoFactor.startSetup(auth, clientInfo(req));
  }

  @Post("confirm")
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(twoFactorCodeInputSchema)) body: CodeBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RecoveryCodesResponse> {
    res.setHeader("Cache-Control", "no-store");
    return this.twoFactor.confirmSetup(auth, body.code, clientInfo(req));
  }

  @Post("disable")
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  disable(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(twoFactorCodeInputSchema)) body: CodeBody,
    @Req() req: Request,
  ): Promise<void> {
    return this.twoFactor.disable(auth, body.code, clientInfo(req));
  }

  @Post("recovery-codes")
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  regenerate(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(twoFactorCodeInputSchema)) body: CodeBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RecoveryCodesResponse> {
    res.setHeader("Cache-Control", "no-store");
    return this.twoFactor.regenerateRecoveryCodes(auth, body.code, clientInfo(req));
  }

  private async finishSignIn(req: Request, res: Response, factor: SecondFactor): Promise<SessionResponse> {
    res.setHeader("Cache-Control", "no-store");
    const client = clientInfo(req);
    try {
      const done = await this.challenges.complete(this.challenges.readToken(req), factor, client);
      const method = firstFactors.find((candidate) => candidate === done.method) ?? "password";
      const session = await this.loginSessions.open(done.userId, method, client, { twoFactor: true });

      this.challenges.clearCookie(res);
      this.sessions.setCookie(res, session.token, session.expiresAt);
      return { user: await this.auth.getUser(done.userId) };
    } catch (error) {
      // A dead challenge can't be retried; drop the cookie so the page sends the person back to sign in.
      const code = error instanceof ApiError ? (error.getResponse() as { code?: string }).code : undefined;
      if (code === "TWO_FACTOR_CHALLENGE_INVALID") this.challenges.clearCookie(res);
      throw error;
    }
  }
}
