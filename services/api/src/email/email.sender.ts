import { Logger } from "@nestjs/common";
import { createTransport } from "nodemailer";
import type { SmtpConfig } from "@repo/config/server";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailOperation = "verification_email" | "account_exists_email" | "reset_password_email" | "security_notice";

/** Email delivery provider. */
export interface EmailSender {
  send(message: EmailMessage, operation?: EmailOperation): Promise<void>;
}

export const EMAIL_SENDER = Symbol("EMAIL_SENDER");

/** Sends transactional messages through the configured SMTP server. */
export class SmtpEmailSender implements EmailSender {
  private readonly transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      // Never fall back to plaintext: STARTTLS is mandatory on non-implicit-TLS ports, and
      // certificates are always verified.
      ...(!config.secure ? { requireTLS: true } : {}),
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      ...(config.auth ? { auth: config.auth } : {}),
    });
  }

  async send(message: EmailMessage, operation: EmailOperation = "verification_email"): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.config.from, ...message });
      this.logger.log(this.logMessage(operation, true), this.logMetadata(message, operation, { success: true }));
    } catch (error) {
      this.logger.error(
        this.logMessage(operation, false),
        undefined,
        this.logMetadata(message, operation, {
          success: false,
          ...safeErrorDetails(error, [
            this.config.auth?.pass,
            this.config.auth?.user,
            this.config.from,
            message.to,
            message.text,
          ]),
        }),
      );
      throw error;
    }
  }

  private readonly logger = new Logger(SmtpEmailSender.name);

  private logMessage(operation: EmailOperation | undefined, success: boolean): string {
    if (operation === "verification_email") return success ? "Verification email sent" : "Verification email failed";
    if (operation === "reset_password_email") return success ? "Password reset email sent" : "Password reset email failed";
    return success ? "Email sent" : "Email delivery failed";
  }

  private logMetadata(
    message: EmailMessage,
    operation: EmailOperation | undefined,
    result: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      operation: operation ?? "email",
      recipient: maskRecipient(message.to),
      smtpHost: this.config.host,
      smtpPort: this.config.port,
      smtpSecure: this.config.secure,
      smtpConfigured: true,
      passwordLoaded: Boolean(this.config.auth?.pass),
      ...result,
    };
  }
}

function maskRecipient(recipient: string): string {
  const separator = recipient.lastIndexOf("@");
  if (separator <= 0 || separator === recipient.length - 1) return "***";
  return `${recipient[0]}***${recipient.slice(separator)}`;
}

function safeErrorDetails(error: unknown, sensitiveValues: (string | undefined)[]): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorMessage: "Unknown SMTP error" };

  const smtpError = error as Error & { code?: unknown; responseCode?: unknown };
  let errorMessage = error.message;
  for (const value of sensitiveValues) {
    if (value) errorMessage = errorMessage.split(value).join("<redacted>");
  }
  errorMessage = errorMessage.replace(/#token=[\w-]+/gi, "#token=<redacted>").slice(0, 300);

  return {
    ...(typeof smtpError.code === "string" && /^[A-Z0-9_-]{1,40}$/i.test(smtpError.code)
      ? { errorCode: smtpError.code }
      : {}),
    ...(typeof smtpError.responseCode === "number" && Number.isInteger(smtpError.responseCode)
      ? { smtpResponseCode: smtpError.responseCode }
      : {}),
    errorMessage,
  };
}

/**
 * Development fallback: records that email delivery was skipped. Message bodies and links
 * containing one-time tokens are never logged.
 */
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger("Email");

  async send(message: EmailMessage, operation: EmailOperation = "verification_email"): Promise<void> {
    this.logger.warn(
      operation === "verification_email" ? "Verification email not sent (SMTP not configured)" : "Email not sent (SMTP not configured)",
      {
        operation,
        recipient: maskRecipient(message.to),
        smtpHost: null,
        smtpPort: null,
        smtpSecure: null,
        smtpConfigured: false,
        passwordLoaded: false,
        success: false,
      },
    );
  }
}
