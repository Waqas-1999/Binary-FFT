import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ServerConfig } from "@repo/config/server";
import { toErrorMessage } from "@repo/utils";
import type { CookieOptions, Request, Response } from "express";
import { type ClientInfo, readCookie } from "../common/client-info.ts";
import { SERVER_CONFIG } from "../config/config.module.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { authConfig, sessionCookieName } from "./auth.config.ts";
import { generateToken, hashToken } from "./tokens.ts";

/** Attached to authenticated requests by `AuthGuard`. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  /** When this session last passed a strong authentication (sign-in or reauthentication). */
  authenticatedAt: Date;
}

/** Identifies a session without implying anything about how recently it authenticated. */
export type SessionRef = Pick<AuthContext, "userId" | "sessionId">;

const { ttlSeconds, idleTimeoutSeconds, activityUpdateIntervalSeconds } = authConfig.session;

/**
 * Server-side sessions. The browser holds an opaque random token in an HttpOnly cookie; the
 * database stores only its SHA-256 hash, so a database leak does not expose usable sessions.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SERVER_CONFIG) config: ServerConfig,
  ) {
    this.cookieName = sessionCookieName(config.app.isProduction);
    this.cookieOptions = {
      httpOnly: true,
      secure: config.app.isProduction,
      sameSite: "lax",
      path: "/",
    };
  }

  async create(userId: string, client: ClientInfo): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const session = await this.prisma.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt, ipAddress: client.ip, userAgent: client.userAgent },
      select: { id: true },
    });
    return { token, sessionId: session.id, expiresAt };
  }

  /** Returns the session for a valid token, or null if unknown, revoked, expired, idle or the user is disabled. */
  async authenticate(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        lastActiveAt: true,
        authenticatedAt: true,
        user: { select: { status: true } },
      },
    });
    const now = Date.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.lastActiveAt.getTime() + idleTimeoutSeconds * 1000 <= now ||
      session.user.status !== "ACTIVE"
    ) {
      return null;
    }

    if (now - session.lastActiveAt.getTime() > activityUpdateIntervalSeconds * 1000) {
      // Throttled and off the request's critical path.
      this.prisma.session
        .update({ where: { id: session.id }, data: { lastActiveAt: new Date(now) }, select: { id: true } })
        .catch((error: unknown) => this.logger.warn(`Failed to update session activity: ${toErrorMessage(error)}`));
    }
    return { userId: session.userId, sessionId: session.id, authenticatedAt: session.authenticatedAt };
  }

  /** Revokes the session for a token. Returns the revoked session, or null if it was already inactive. */
  async revokeByToken(token: string): Promise<SessionRef | null> {
    const tokenHash = hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!session || session.revokedAt) return null;

    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1 ? { userId: session.userId, sessionId: session.id } : null;
  }

  /** The user's live sessions, most recently active first. */
  listActive(userId: string) {
    const now = Date.now();
    return this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
        lastActiveAt: { gt: new Date(now - idleTimeoutSeconds * 1000) },
      },
      orderBy: { lastActiveAt: "desc" },
      select: { id: true, createdAt: true, lastActiveAt: true, ipAddress: true, userAgent: true },
    });
  }

  /** Revokes one of the user's own sessions. False if it doesn't exist, isn't theirs or is already revoked. */
  async revokeOwned(userId: string, sessionId: string): Promise<boolean> {
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }

  /** Revokes every other live session in one statement; returns how many. */
  async revokeOthers(userId: string, keepSessionId: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: keepSessionId } },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** Records a successful reauthentication on this session. */
  async markAuthenticated(sessionId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { authenticatedAt: new Date() }, select: { id: true } });
  }

  readToken(req: Request): string | undefined {
    return readCookie(req, this.cookieName);
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.cookieName, token, { ...this.cookieOptions, expires: expiresAt });
  }

  clearCookie(res: Response): void {
    res.clearCookie(this.cookieName, this.cookieOptions);
  }
}
