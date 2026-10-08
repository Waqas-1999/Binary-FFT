import { Inject, Injectable } from "@nestjs/common";
import type { ProfileAvatar, ProfileResponse } from "@repo/types";
import { maskPhoneNumber, type UpdateProfileInput } from "@repo/validation";
import { AuthEventsService } from "../auth/auth-events.service.ts";
import { AuthService } from "../auth/auth.service.ts";
import type { AuthContext } from "../auth/session.service.ts";
import type { ClientInfo } from "../common/client-info.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { RateLimitService } from "../rate-limit/rate-limit.service.ts";
import { profileConfig } from "./profile.config.ts";
import { SMS_PROVIDER, type SmsProvider } from "./sms/sms.provider.ts";
import { TelegramService } from "./telegram/telegram.service.ts";

/** Reads and edits the signed-in user's own profile. The user always comes from the session, never the request. */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly events: AuthEventsService,
    private readonly rateLimit: RateLimitService,
    private readonly telegram: TelegramService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async get({ userId }: AuthContext): Promise<ProfileResponse> {
    const [identity, user] = await Promise.all([
      this.auth.getUser(userId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          displayName: true,
          timeZone: true,
          phone: { select: { phoneNumber: true } },
          phoneChallenge: { select: { phoneNumber: true, expiresAt: true, consumedAt: true } },
          telegramConnection: { select: { id: true } },
        },
      }),
    ]);

    const challenge = user.phoneChallenge;
    const pending = challenge && !challenge.consumedAt && challenge.expiresAt.getTime() > Date.now() ? challenge : null;
    return {
      userNumber: identity.userNumber,
      displayName: user.displayName,
      email: identity.email,
      emailVerified: identity.emailVerified,
      avatar: avatarFor(user.displayName, identity.email),
      mobile: {
        masked: user.phone ? maskPhoneNumber(user.phone.phoneNumber) : null,
        verified: Boolean(user.phone),
        pending: pending ? { masked: maskPhoneNumber(pending.phoneNumber), expiresAt: pending.expiresAt.toISOString() } : null,
        available: this.sms.configured,
      },
      google: { connected: identity.googleConnected },
      telegram: { connected: Boolean(user.telegramConnection), available: this.telegram.available },
      settings: { timeZone: user.timeZone },
    };
  }

  async update(auth: AuthContext, input: UpdateProfileInput, client: ClientInfo): Promise<ProfileResponse> {
    await this.rateLimit.consume(`profile-update:user:${auth.userId}`, profileConfig.rateLimits.profileUpdatePerUser);

    const fields: string[] = [];
    const data: { displayName?: string | null; timeZone?: string | null } = {};
    if (input.displayName !== undefined) {
      data.displayName = input.displayName;
      fields.push("displayName");
    }
    if (input.timeZone !== undefined) {
      data.timeZone = input.timeZone;
      fields.push("timeZone");
    }
    await this.prisma.user.update({ where: { id: auth.userId }, data, select: { id: true } });

    // Which fields changed, never their values.
    await this.events.record("PROFILE_UPDATED", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { fields } });
    return this.get(auth);
  }
}

/** Initials of the display name, or the first letter of the email when there is none. */
export function avatarFor(displayName: string | null, email: string): ProfileAvatar {
  const words = (displayName ?? "").split(" ").filter(Boolean);
  const letters = words.length > 0 ? words.slice(0, 2).map((word) => Array.from(word)[0] ?? "") : [Array.from(email)[0] ?? ""];
  return { kind: "initials", text: letters.join("").toUpperCase() || "?" };
}
