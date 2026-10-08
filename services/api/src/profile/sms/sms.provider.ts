import { brand } from "@repo/config";

export interface VerificationSms {
  /** E.164 number. */
  to: string;
  /** The plaintext code. Providers must send it and nothing else: never log it. */
  code: string;
  expiresInMinutes: number;
}

/**
 * SMS delivery. Callers depend on this interface, never on a vendor. A real adapter (Twilio, a regional
 * gateway, ...) implements it and is registered for `SMS_PROVIDER` in `ProfileModule`.
 */
export interface SmsProvider {
  /** False when no gateway is configured; the profile then hides the mobile flow. */
  readonly configured: boolean;
  /** Throws if the message could not be handed to the gateway. */
  sendVerificationCode(sms: VerificationSms): Promise<void>;
}

export const SMS_PROVIDER = Symbol("SMS_PROVIDER");

/** Wording shared by real adapters so the message is the same whichever gateway sends it. */
export function verificationSmsText({ code, expiresInMinutes }: Pick<VerificationSms, "code" | "expiresInMinutes">): string {
  return `${brand.name}: your verification code is ${code}. It expires in ${expiresInMinutes} minutes. Never share it with anyone.`;
}

/**
 * Default when no gateway is wired in. It sends nothing and says so, so mobile verification is
 * reported as unavailable instead of pretending to work. It never receives or logs a code.
 */
export class UnavailableSmsProvider implements SmsProvider {
  readonly configured = false;

  async sendVerificationCode(): Promise<void> {
    throw new Error("No SMS provider is configured");
  }
}
