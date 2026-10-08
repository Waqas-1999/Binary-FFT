import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Req, Res } from "@nestjs/common";
import type { PhoneCodeSentResponse, ProfileResponse, TelegramLinkResponse } from "@repo/types";
import {
  requestPhoneCodeSchema,
  updateProfileSchema,
  verifyPhoneCodeSchema,
  type RequestPhoneCodeInput,
  type UpdateProfileInput,
  type VerifyPhoneCodeInput,
} from "@repo/validation";
import type { Request, Response } from "express";
import { Authenticated, CurrentAuth } from "../auth/auth.guard.ts";
import type { AuthContext } from "../auth/session.service.ts";
import { clientInfo } from "../common/client-info.ts";
import { ZodValidationPipe } from "../common/zod-validation.pipe.ts";
import { MobileService } from "./mobile.service.ts";
import { ProfileService } from "./profile.service.ts";
import { TelegramService } from "./telegram/telegram.service.ts";

/**
 * The signed-in user's own profile, mobile number and Telegram connection. The account is always taken
 * from the session; no request field can name another user.
 */
@Controller("profile")
@Authenticated()
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly mobile: MobileService,
    private readonly telegram: TelegramService,
  ) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<ProfileResponse> {
    res.setHeader("Cache-Control", "no-store");
    return this.profile.get(auth);
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProfileResponse> {
    res.setHeader("Cache-Control", "no-store");
    return this.profile.update(auth, body, clientInfo(req));
  }

  /** Texts a code to the number. Needs a recent authentication. */
  @Post("mobile/send-code")
  @HttpCode(HttpStatus.OK)
  sendCode(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(requestPhoneCodeSchema)) body: RequestPhoneCodeInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PhoneCodeSentResponse> {
    res.setHeader("Cache-Control", "no-store");
    return this.mobile.requestCode(auth, body.phoneNumber, clientInfo(req));
  }

  @Post("mobile/verify")
  @HttpCode(HttpStatus.NO_CONTENT)
  verify(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(verifyPhoneCodeSchema)) body: VerifyPhoneCodeInput,
    @Req() req: Request,
  ): Promise<void> {
    return this.mobile.verify(auth, body.code, clientInfo(req));
  }

  @Delete("mobile")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMobile(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<void> {
    return this.mobile.remove(auth, clientInfo(req));
  }

  @Post("telegram/link")
  @HttpCode(HttpStatus.OK)
  linkTelegram(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TelegramLinkResponse> {
    res.setHeader("Cache-Control", "no-store");
    return this.telegram.startLink(auth, clientInfo(req));
  }

  @Delete("telegram")
  @HttpCode(HttpStatus.NO_CONTENT)
  unlinkTelegram(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<void> {
    return this.telegram.disconnect(auth, clientInfo(req));
  }
}
