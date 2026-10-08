import { Body, Controller, Get, Patch, Req, Res } from "@nestjs/common";
import type { NotificationPreferencesResponse } from "@repo/types";
import { updateNotificationPreferencesSchema, type UpdateNotificationPreferencesInput } from "@repo/validation";
import type { Request, Response } from "express";
import { Authenticated, CurrentAuth } from "../auth/auth.guard.ts";
import type { AuthContext } from "../auth/session.service.ts";
import { clientInfo } from "../common/client-info.ts";
import { ZodValidationPipe } from "../common/zod-validation.pipe.ts";
import { NotificationPreferencesService } from "./notification-preferences.service.ts";

/** The signed-in user's own notification choices. */
@Controller("notifications")
@Authenticated()
export class NotificationsController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get("preferences")
  get(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<NotificationPreferencesResponse> {
    res.setHeader("Cache-Control", "no-store");
    return this.preferences.get(auth.userId);
  }

  @Patch("preferences")
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateNotificationPreferencesSchema)) body: UpdateNotificationPreferencesInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<NotificationPreferencesResponse> {
    res.setHeader("Cache-Control", "no-store");
    return this.preferences.update(auth, body, clientInfo(req));
  }
}
