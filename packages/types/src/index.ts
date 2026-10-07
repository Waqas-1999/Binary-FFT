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
  email: string;
  emailVerified: boolean;
}

export interface SessionResponse {
  user: AuthUser;
}
