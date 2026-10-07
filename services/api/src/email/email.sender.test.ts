import { Logger } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const smtp = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail }));
  return { createTransport, sendMail };
});

vi.mock("nodemailer", () => ({ createTransport: smtp.createTransport }));

import { LogEmailSender, SmtpEmailSender } from "./email.sender.ts";

describe("SmtpEmailSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    smtp.sendMail.mockResolvedValue({});
  });

  it("sends the message with the configured sender and SMTP transport", async () => {
    const sender = new SmtpEmailSender({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "mailer", pass: "secret" },
      from: "Platform <noreply@example.com>",
    });

    await sender.send({ to: "user@example.com", subject: "Verify", text: "Click the link" });

    expect(smtp.createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      auth: { user: "mailer", pass: "secret" },
    });
    expect(smtp.sendMail).toHaveBeenCalledWith({
      from: "Platform <noreply@example.com>",
      to: "user@example.com",
      subject: "Verify",
      text: "Click the link",
    });
  });

  it("requires STARTTLS before authenticated SMTP when implicit TLS is disabled", () => {
    new SmtpEmailSender({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: "mailer@example.com", pass: "secret" },
      from: "mailer@example.com",
    });

    expect(smtp.createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      requireTLS: true,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      auth: { user: "mailer@example.com", pass: "secret" },
    });
  });

  it("logs safe SMTP diagnostics for failed verification email delivery", async () => {
    const error = Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), {
      code: "EAUTH",
      responseCode: 535,
    });
    smtp.sendMail.mockRejectedValueOnce(error);
    const logError = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const sender = new SmtpEmailSender({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: "mailer@example.com", pass: "do-not-log-this-password" },
      from: "mailer@example.com",
    });

    await expect(
      sender.send(
        { to: "waqas@example.com", subject: "Verify", text: "token=#token=secret-token" },
        "verification_email",
      ),
    ).rejects.toBe(error);

    expect(logError).toHaveBeenCalledWith(
      "Verification email failed",
      undefined,
      expect.objectContaining({
        operation: "verification_email",
        recipient: "w***@example.com",
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpSecure: false,
        smtpConfigured: true,
        passwordLoaded: true,
        success: false,
        errorCode: "EAUTH",
        smtpResponseCode: 535,
        errorMessage: "Invalid login: 535-5.7.8 Username and Password not accepted",
      }),
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain("do-not-log-this-password");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret-token");
    logError.mockRestore();
  });

  it("never logs email bodies from the development fallback", async () => {
    const logWarn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const sender = new LogEmailSender();

    await sender.send(
      { to: "waqas@example.com", subject: "Verify", text: "secret verification token" },
      "verification_email",
    );

    expect(logWarn).toHaveBeenCalledWith(
      "Verification email not sent (SMTP not configured)",
      expect.objectContaining({
        operation: "verification_email",
        recipient: "w***@example.com",
        smtpHost: null,
        smtpPort: null,
        smtpSecure: null,
        smtpConfigured: false,
        passwordLoaded: false,
        success: false,
      }),
    );
    expect(JSON.stringify(logWarn.mock.calls)).not.toContain("secret verification token");
    logWarn.mockRestore();
  });

  it("propagates provider failures to the caller", async () => {
    smtp.sendMail.mockRejectedValueOnce(new Error("SMTP connection failed"));
    const sender = new SmtpEmailSender({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      from: "noreply@example.com",
    });

    await expect(sender.send({ to: "user@example.com", subject: "Verify", text: "Click the link" })).rejects.toThrow(
      "SMTP connection failed",
    );
  });
});
