export interface ValidationIssue {
  path: string;
  message: string;
}

/** Machine-readable error codes. Clients map these to friendly copy and never show `message`. */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_VERIFIED"
  | "VERIFICATION_LINK_INVALID"
  | "PASSWORD_RESET_INVALID"
  | "PASSWORD_RESET_EXPIRED"
  | "PASSWORD_RESET_USED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "FORBIDDEN_ORIGIN"
  | "OAUTH_STATE_INVALID"
  | "OAUTH_STATE_REUSED"
  | "OAUTH_ACCOUNT_CONFLICT"
  | "OAUTH_LINK_REJECTED"
  | "TWO_FACTOR_CODE_INVALID"
  | "TWO_FACTOR_CHALLENGE_INVALID"
  | "TWO_FACTOR_ALREADY_ENABLED"
  | "TWO_FACTOR_NOT_ENABLED"
  | "REAUTHENTICATION_REQUIRED"
  | "PHONE_CODE_INVALID"
  | "TELEGRAM_ALREADY_CONNECTED"
  | "TELEGRAM_NOT_CONNECTED"
  | "FEATURE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

/** Shape of every error response returned by the API. */
export interface ApiErrorResponse {
  statusCode: number;
  code: ApiErrorCode;
  error: string;
  message: string;
  issues?: ValidationIssue[];
  path: string;
  requestId: string;
  timestamp: string;
}

export type DependencyStatus = "up" | "down";

export interface HealthResponse {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

/** The signed-in user as exposed to clients. */
export interface AuthUser {
  userNumber: number;
  /** Sign-in email; for Google-only accounts, the email Google reported. */
  email: string;
  emailVerified: boolean;
  /** Whether a Google account is connected to this user. */
  googleConnected: boolean;
}

/** Reasons the Google sign-in redirect returns to `/login?error=...`. Never more specific than needed. */
export type OAuthLoginError = "oauth_failed" | "oauth_account_exists" | "oauth_unavailable";

/** Outcomes of the Google linking redirect back to `/profile?google=...`. */
export type OAuthLinkResult = "linked" | "conflict" | "failed";

/** Outcomes of the Google reauthentication redirect back to `/profile?reauth=...`. */
export type OAuthReauthResult = "ok" | "failed";

export interface SessionResponse {
  user: AuthUser;
}

/** Returned by sign-in when the account has two-factor on; the challenge itself travels in an HttpOnly cookie. */
export interface TwoFactorRequiredResponse {
  status: "two_factor_required";
}

export type LoginResponse = SessionResponse | TwoFactorRequiredResponse;

/** The signed-in user's security settings, as computed by the server. */
export interface SecurityStatus {
  /** False for Google-only accounts: there is no password to change or confirm. */
  hasPassword: boolean;
  googleConnected: boolean;
  twoFactor: { enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number };
  /** Two-factor setup is unavailable until the server has an encryption key (development only). */
  twoFactorAvailable: boolean;
  /** Whether the session passed a strong authentication recently enough for sensitive actions. */
  recentlyAuthenticated: boolean;
}

/** Shown once during setup. The secret is never returned again. */
export interface TwoFactorSetup {
  /** `otpauth://` URI for the QR code. */
  otpauthUri: string;
  /** The same secret, for typing in by hand. */
  secret: string;
  expiresInSeconds: number;
}

/** Recovery codes are shown exactly once, right after they are generated. */
export interface RecoveryCodesResponse {
  recoveryCodes: string[];
}

/** One signed-in device, safe to show: never a token or token hash. */
export interface SessionInfo {
  id: string;
  /** True for the session making this request. */
  current: boolean;
  createdAt: string;
  lastActiveAt: string;
  ipAddress: string | null;
  device: { browser: string; os: string };
}

export type SessionsResponse = { sessions: SessionInfo[] };

/** Initials shown in place of a picture. Uploaded pictures are not supported yet. */
export interface ProfileAvatar {
  kind: "initials";
  text: string;
}

/** The signed-in user's profile. Contains no internal IDs, secrets or full phone numbers. */
export interface ProfileResponse {
  /** Public account number (10000+); assigned by the server and never changeable. */
  userNumber: number;
  displayName: string | null;
  email: string;
  emailVerified: boolean;
  avatar: ProfileAvatar;
  mobile: {
    /** Verified number with all but the last four digits hidden; null when none is verified. */
    masked: string | null;
    verified: boolean;
    /** A number waiting for its code. Never counts as verified. */
    pending: { masked: string; expiresAt: string } | null;
    /** False when the server has no SMS provider; the UI hides the flow. */
    available: boolean;
  };
  google: { connected: boolean };
  telegram: { connected: boolean; available: boolean };
  settings: {
    /** IANA time zone chosen by the user, or null to follow the device. */
    timeZone: string | null;
  };
}

export interface PhoneCodeSentResponse {
  status: "code_sent" | "already_verified";
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface TelegramLinkResponse {
  /** https://t.me/<bot>?start=<one-time token>. The token is single-use and short-lived. */
  url: string;
  expiresInSeconds: number;
}

export interface NotificationPreferencesResponse {
  email: {
    /** Always on: security email protects the account and cannot be turned off. */
    security: true;
    account: boolean;
    trading: boolean;
    promotions: boolean;
  };
  telegram: {
    connected: boolean;
    security: boolean;
    account: boolean;
    trading: boolean;
    promotions: boolean;
  };
  /** Push notifications do not exist yet. */
  push: { available: false };
}
