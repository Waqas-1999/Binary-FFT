import { Inject, Injectable } from "@nestjs/common";
import { brand } from "@repo/config";
import { EMAIL_SENDER, type EmailOperation, type EmailSender } from "./email.sender.ts";

export type SecurityNoticeKind =
  | "password_changed"
  | "two_factor_enabled"
  | "two_factor_disabled"
  | "recovery_codes_regenerated"
  | "new_login";

export interface SecurityNotice {
  kind: SecurityNoticeKind;
  /** When it happened. */
  at: Date;
  /** Coarse context for new-login notices, e.g. "Chrome on Windows". Never a secret. */
  device?: string;
  ip?: string | null;
}

const securityNotices: Record<SecurityNoticeKind, { subject: (brand: string) => string; what: (brand: string) => string }> = {
  password_changed: {
    subject: (brand) => `Your ${brand} password was changed`,
    what: (brand) => `The password for your ${brand} account was changed. Your other devices were signed out.`,
  },
  two_factor_enabled: {
    subject: (brand) => `Two-factor authentication is on for your ${brand} account`,
    what: (brand) => `Two-factor authentication (an authenticator app) was turned on for your ${brand} account.`,
  },
  two_factor_disabled: {
    subject: (brand) => `Two-factor authentication was turned off for your ${brand} account`,
    what: (brand) => `Two-factor authentication was turned off for your ${brand} account. Your account is now protected by your sign-in method alone.`,
  },
  recovery_codes_regenerated: {
    subject: (brand) => `New recovery codes for your ${brand} account`,
    what: (brand) => `A new set of recovery codes was created for your ${brand} account. Your old codes no longer work.`,
  },
  new_login: {
    subject: (brand) => `New sign-in to your ${brand} account`,
    what: (brand) => `Your ${brand} account was just signed in to from a browser or device we haven't seen before.`,
  },
};

/** Transactional emails. Callers depend on this service, never on a provider. */
@Injectable()
export class EmailService {
  constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

  async sendVerificationEmail(to: string, verifyUrl: string, expiresInHours: number): Promise<void> {
    await this.deliver({
      to,
      subject: `Verify your email for ${brand.name}`,
      text: [
        `Welcome to ${brand.name}!`,
        "",
        "Confirm your email address to finish creating your account:",
        verifyUrl,
        "",
        `This link works once and expires in ${duration(expiresInHours)}.`,
        "If you didn't create an account, you can ignore this email.",
      ].join("\n"),
    }, "verification_email");
  }

  /** Sent when someone signs up with an address that already has a verified account. */
  async sendAccountExistsEmail(to: string, loginUrl: string): Promise<void> {
    await this.deliver({
      to,
      subject: `You already have a ${brand.name} account`,
      text: [
        `Someone tried to create a ${brand.name} account with this email address, but you already have one.`,
        "",
        "Sign in here:",
        loginUrl,
        "",
        "If this wasn't you, you can ignore this email. Your account is unchanged.",
      ].join("\n"),
    }, "account_exists_email");
  }

  /** Sent when a password reset is requested. The raw token travels only in the URL fragment. */
  async sendPasswordResetEmail(to: string, resetUrl: string, expiresInHours: number): Promise<void> {
    await this.deliver({
      to,
      subject: `Reset your ${brand.name} password`,
      text: [
        `We received a request to reset your ${brand.name} password.`,
        "",
        "If you made this request, open the link below and follow the instructions:",
        resetUrl,
        "",
        `This link works once and expires in ${duration(expiresInHours)}.`,
        "",
        "If you did not request a password reset, you can safely ignore this email. Your password and account are unchanged.",
      ].join("\n"),
    }, "reset_password_email");
  }

  /**
   * Tells someone about a security-relevant change to their account. Says what happened and what to
   * do if it wasn't them; never contains codes, tokens or passwords.
   */
  async sendSecurityNotice(to: string, notice: SecurityNotice): Promise<void> {
    const template = securityNotices[notice.kind];
    const lines = [template.what(brand.name), "", `When: ${notice.at.toUTCString()}`];
    if (notice.device) lines.push(`Device: ${notice.device}`);
    if (notice.ip) lines.push(`Network address: ${notice.ip}`);
    lines.push(
      "",
      "If this was you, there's nothing to do.",
      "",
      "If this wasn't you, secure your account now: reset your password, then open Profile > Security to sign out other devices and review your two-factor settings.",
    );
    await this.deliver({ to, subject: template.subject(brand.name), text: lines.join("\n") }, "security_notice");
  }

  private async deliver(
    message: Parameters<EmailSender["send"]>[0],
    operation: EmailOperation,
  ): Promise<void> {
    await this.sender.send(message, operation);
  }
}

function duration(hours: number): string {
  return hours === 1 ? "1 hour" : `${hours} hours`;
}
