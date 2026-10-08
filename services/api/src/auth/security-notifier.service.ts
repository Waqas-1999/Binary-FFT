import { Injectable, Logger } from "@nestjs/common";
import { toErrorMessage } from "@repo/utils";
import { plainIp, summarizeUserAgent } from "../common/user-agent.ts";
import type { ClientInfo } from "../common/client-info.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { EmailService, type SecurityNoticeKind } from "../email/email.service.ts";

/**
 * Emails people about security changes to their account. Best effort: a failed email never fails the
 * action it reports, and callers don't wait for delivery.
 */
@Injectable()
export class SecurityNotifier {
  private readonly logger = new Logger(SecurityNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailService,
  ) {}

  /** Fire and forget. */
  notify(userId: string, kind: SecurityNoticeKind, client?: ClientInfo): void {
    void this.send(userId, kind, client).catch((error: unknown) => {
      this.logger.warn(`Security notice "${kind}" not sent: ${toErrorMessage(error)}`);
    });
  }

  private async send(userId: string, kind: SecurityNoticeKind, client?: ClientInfo): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        emailAccount: { select: { email: true, emailVerifiedAt: true } },
        oAuthIdentities: { where: { provider: "GOOGLE" }, select: { emailAtLinkTime: true } },
      },
    });
    // Only a verified address: an unverified one may not belong to the account's owner.
    const to =
      (user?.emailAccount?.emailVerifiedAt ? user.emailAccount.email : undefined) ??
      user?.oAuthIdentities[0]?.emailAtLinkTime ??
      undefined;
    if (!to) return;

    const device = client?.userAgent ? summarizeUserAgent(client.userAgent) : undefined;
    await this.emails.sendSecurityNotice(to, {
      kind,
      at: new Date(),
      ...(device ? { device: `${device.browser} on ${device.os}` } : {}),
      ip: plainIp(client?.ip),
    });
  }
}
