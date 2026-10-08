import { Injectable } from "@nestjs/common";
import type { ClientInfo } from "../common/client-info.ts";
import { deviceKey } from "../common/user-agent.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { AuthEventsService } from "./auth-events.service.ts";
import { LoginChallengeService } from "./login-challenge.service.ts";
import { SecurityNotifier } from "./security-notifier.service.ts";
import { SessionService } from "./session.service.ts";
import { TwoFactorService } from "./two-factor/two-factor.service.ts";

/** How the person got through the first factor; decides the audit event when the sign-in completes. */
export type FirstFactor = "password" | "email_verification" | "google";

export type SignInOutcome =
  | { kind: "session"; token: string; sessionId: string; expiresAt: Date }
  | { kind: "challenge"; token: string; expiresAt: Date };

/** Past sessions looked at when deciding whether a device is new. */
const HISTORY = 100;

/**
 * The one place a sign-in turns into a session. After the first factor (password, email link or
 * Google) it either opens the session or, when the user has two-factor on, parks the sign-in in a
 * challenge. Opening a session also records the event and emails about unfamiliar devices.
 */
@Injectable()
export class LoginSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly challenges: LoginChallengeService,
    private readonly events: AuthEventsService,
    private readonly notifier: SecurityNotifier,
  ) {}

  /** Call only after the first factor succeeded and the account was confirmed active. */
  async afterFirstFactor(userId: string, method: FirstFactor, client: ClientInfo, extra: Record<string, boolean> = {}): Promise<SignInOutcome> {
    if (await this.twoFactor.isEnabled(userId)) {
      const challenge = await this.challenges.create(userId, method);
      await this.events.record("NEW_LOGIN_2FA_REQUIRED", { userId, client, metadata: { method } });
      return { kind: "challenge", ...challenge };
    }
    return this.open(userId, method, client, extra);
  }

  /** Opens the session (after the second factor, or when there isn't one). */
  async open(userId: string, method: FirstFactor, client: ClientInfo, extra: Record<string, boolean> = {}): Promise<SignInOutcome & { kind: "session" }> {
    const unfamiliar = await this.isUnfamiliarDevice(userId, client);
    const session = await this.sessions.create(userId, client);

    await this.events.record(method === "google" ? "GOOGLE_LOGIN_SUCCESS" : "LOGIN_SUCCESS", {
      userId,
      sessionId: session.sessionId,
      client,
      metadata: { method, ...extra },
    });
    if (unfamiliar) {
      await this.events.record("NEW_LOGIN", { userId, sessionId: session.sessionId, client });
      this.notifier.notify(userId, "new_login", client);
    }
    return { kind: "session", ...session };
  }

  /**
   * A device is unfamiliar when none of the user's earlier sessions used the same browser and OS. A
   * user's very first session is never "new", and a known browser on a new network doesn't count.
   */
  private async isUnfamiliarDevice(userId: string, client: ClientInfo): Promise<boolean> {
    const previous = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: HISTORY,
      select: { userAgent: true },
    });
    if (previous.length === 0) return false;
    const current = deviceKey(client.userAgent);
    return !previous.some((session) => deviceKey(session.userAgent) === current);
  }
}
