import { Injectable, Logger } from "@nestjs/common";
import { toErrorMessage } from "@repo/utils";
import type { ClientInfo } from "../common/client-info.ts";
import { PrismaService } from "../database/prisma.service.ts";
import type { AuthEventType, Prisma } from "../generated/prisma/client.js";

export interface AuthEventInput {
  userId?: string;
  sessionId?: string;
  /** Only for events without a known user, e.g. failed logins. */
  email?: string;
  client?: ClientInfo;
  /** Non-sensitive context only: never passwords, hashes or tokens. */
  metadata?: Prisma.InputJsonObject;
}

/** Append-only security event log. Recording never breaks the user's request. */
@Injectable()
export class AuthEventsService {
  private readonly logger = new Logger(AuthEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(type: AuthEventType, event: AuthEventInput = {}): Promise<void> {
    try {
      await this.prisma.authEvent.create({
        data: {
          type,
          userId: event.userId,
          sessionId: event.sessionId,
          email: event.email,
          ipAddress: event.client?.ip,
          userAgent: event.client?.userAgent,
          metadata: event.metadata,
        },
        select: { id: true },
      });
    } catch (error) {
      this.logger.error(`Failed to record auth event ${type}: ${toErrorMessage(error)}`);
    }
  }
}
