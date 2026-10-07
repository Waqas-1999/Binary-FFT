import { Inject, Injectable } from "@nestjs/common";
import { brand } from "@repo/config";
import { EMAIL_SENDER, type EmailOperation, type EmailSender } from "./email.sender.ts";

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
        `This link works once and expires in ${expiresInHours} hours.`,
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
        `This link works once and expires in ${expiresInHours} hours.`,
        "",
        "If you did not request a password reset, you can safely ignore this email. Your password and account are unchanged.",
      ].join("\n"),
    }, "reset_password_email");
  }

  private async deliver(
    message: Parameters<EmailSender["send"]>[0],
    operation: EmailOperation,
  ): Promise<void> {
    await this.sender.send(message, operation);
  }
}
