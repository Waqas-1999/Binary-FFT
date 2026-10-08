import type { ApiErrorCode, ApiErrorResponse, ValidationIssue } from "@repo/types";

export type ClientErrorCode = ApiErrorCode | "NETWORK_ERROR";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    readonly issues?: ValidationIssue[],
  ) {
    super(code);
  }
}

/** Calls the API through the same-origin `/api` proxy. Throws `ApiRequestError` on failure. */
export async function api<T>(path: string, { method = "GET", body }: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiRequestError(0, "NETWORK_ERROR");
  }

  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data as Partial<ApiErrorResponse> | null;
    throw new ApiRequestError(response.status, error?.code ?? "INTERNAL_ERROR", error?.issues);
  }
  return data as T;
}

const messages: Partial<Record<ClientErrorCode, string>> = {
  INVALID_CREDENTIALS: "That email and password don't match. Please try again.",
  EMAIL_NOT_VERIFIED: "Please verify your email first. We've sent you a new link.",
  VERIFICATION_LINK_INVALID: "This link has expired or has already been used.",
  PASSWORD_RESET_INVALID: "This link has expired or has already been used.",
  TWO_FACTOR_CODE_INVALID: "That code didn't work. Check your authenticator app and try again.",
  TWO_FACTOR_CHALLENGE_INVALID: "Your sign-in timed out. Please sign in again.",
  TWO_FACTOR_ALREADY_ENABLED: "Two-factor authentication is already on.",
  TWO_FACTOR_NOT_ENABLED: "Two-factor authentication isn't on.",
  REAUTHENTICATION_REQUIRED: "Please confirm it's you, then try again.",
  PHONE_CODE_INVALID: "That code didn't work. Check it, or ask for a new one.",
  TELEGRAM_ALREADY_CONNECTED: "Telegram is already connected.",
  TELEGRAM_NOT_CONNECTED: "Telegram isn't connected.",
  FEATURE_UNAVAILABLE: "This isn't available right now. Please try again later.",
  NOT_FOUND: "That device has already been signed out.",
  RATE_LIMITED: "Too many attempts. Please wait a few minutes and try again.",
  NETWORK_ERROR: "Can't connect right now. Check your internet connection and try again.",
  SERVICE_UNAVAILABLE: "We're having trouble right now. Please try again in a moment.",
};

/** Friendly copy for an error. Backend messages are never shown to users. */
export function errorMessage(error: unknown): string {
  const code = error instanceof ApiRequestError ? error.code : undefined;
  return (code && messages[code]) ?? "Something went wrong. Please try again.";
}
