export interface ValidationIssue {
  path: string;
  message: string;
}

/** Shape of every error response returned by the API. */
export interface ApiErrorResponse {
  statusCode: number;
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
