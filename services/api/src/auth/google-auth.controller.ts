import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Query, Req, Res } from "@nestjs/common";
import type { ServerConfig } from "@repo/config/server";
import type { OAuthLinkResult, OAuthLoginError } from "@repo/types";
import type { CookieOptions, Request, Response } from "express";
import { clientInfo, readCookie } from "../common/client-info.ts";
import { SERVER_CONFIG } from "../config/config.module.ts";
import { authConfig, oauthBindingCookieName } from "./auth.config.ts";
import { LoginChallengeService } from "./login-challenge.service.ts";
import { Authenticated, CurrentAuth } from "./auth.guard.ts";
import { GoogleOAuthService } from "./google-oauth.service.ts";
import { type AuthContext, SessionService } from "./session.service.ts";

/** Google sign-in (browser redirects) and linking (initiated by an explicit signed-in request). */
@Controller("auth/google")
export class GoogleAuthController {
  private readonly webAppUrl: string;
  private readonly bindingCookieName: string;
  private readonly bindingCookieOptions: CookieOptions;

  constructor(
    private readonly google: GoogleOAuthService,
    private readonly sessions: SessionService,
    private readonly challenges: LoginChallengeService,
    @Inject(SERVER_CONFIG) config: ServerConfig,
  ) {
    this.webAppUrl = config.app.webAppUrl;
    this.bindingCookieName = oauthBindingCookieName(config.app.isProduction);
    this.bindingCookieOptions = {
      httpOnly: true,
      secure: config.app.isProduction,
      // Lax so the cookie comes back on Google's top-level redirect, but not on cross-site subrequests.
      sameSite: "lax",
      path: "/",
    };
  }

  /** Starts sign-in: sets the browser binding and redirects to Google. */
  @Get()
  async login(@Query("next") next: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    try {
      const flow = await this.google.startLogin(next, clientInfo(req));
      this.setBinding(res, flow.binding);
      res.redirect(HttpStatus.FOUND, flow.authorizationUrl);
    } catch {
      res.redirect(HttpStatus.FOUND, this.loginErrorUrl("oauth_unavailable"));
    }
  }

  /**
   * Google redirects here for both sign-in and linking. The authorization code and state are in the
   * query string and are consumed here; nothing about them is logged, and every outcome is a redirect
   * to a fixed page on this site.
   */
  @Get("callback")
  async callback(
    @Query("state") state: unknown,
    @Query("code") code: unknown,
    @Query("error") error: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");

    const binding = readCookie(req, this.bindingCookieName);
    res.clearCookie(this.bindingCookieName, this.bindingCookieOptions);

    const outcome = await this.google.complete(
      { state: text(state), code: text(code), error: text(error) },
      binding,
      this.sessions.readToken(req),
      clientInfo(req),
    );

    switch (outcome.kind) {
      case "login":
        this.sessions.setCookie(res, outcome.sessionToken, outcome.expiresAt);
        res.redirect(HttpStatus.FOUND, `${this.webAppUrl}${outcome.returnTo}`);
        return;
      case "two-factor":
        // First factor done, second pending: no session yet. The challenge cookie carries the rest.
        this.challenges.setCookie(res, outcome.challengeToken, outcome.expiresAt);
        res.redirect(HttpStatus.FOUND, `${this.webAppUrl}/login?step=two-factor&next=${encodeURIComponent(outcome.returnTo)}`);
        return;
      case "reauth":
        res.redirect(HttpStatus.FOUND, `${this.webAppUrl}/profile?reauth=${outcome.result}`);
        return;
      case "login-failed":
        res.redirect(HttpStatus.FOUND, this.loginErrorUrl(outcome.error));
        return;
      case "link":
        res.redirect(HttpStatus.FOUND, this.profileUrl(outcome.result));
        return;
    }
  }

  /**
   * Starts linking Google to the signed-in account. A POST (so the origin check applies) from an
   * authenticated session: a third-party page cannot start a link flow in someone's browser.
   */
  @Post("link")
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  async link(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ authorizationUrl: string }> {
    res.setHeader("Cache-Control", "no-store");
    const flow = await this.google.startLink(auth.userId, clientInfo(req));
    this.setBinding(res, flow.binding);
    return { authorizationUrl: flow.authorizationUrl };
  }

  /** Starts a fresh Google sign-in for the signed-in user, to confirm it is still them. */
  @Post("reauth")
  @Authenticated()
  @HttpCode(HttpStatus.OK)
  async reauth(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ authorizationUrl: string }> {
    res.setHeader("Cache-Control", "no-store");
    const flow = await this.google.startReauth(auth);
    this.setBinding(res, flow.binding);
    return { authorizationUrl: flow.authorizationUrl };
  }

  private setBinding(res: Response, binding: string): void {
    res.cookie(this.bindingCookieName, binding, {
      ...this.bindingCookieOptions,
      maxAge: authConfig.oAuthStateTtlSeconds * 1000,
    });
  }

  private loginErrorUrl(error: OAuthLoginError): string {
    return `${this.webAppUrl}/login?error=${error}`;
  }

  private profileUrl(result: OAuthLinkResult): string {
    return `${this.webAppUrl}/profile?google=${result}`;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 2048 ? value : undefined;
}
