import { HttpStatus } from "@nestjs/common";
import { ApiError } from "../common/api-error.ts";
import { authConfig } from "./auth.config.ts";
import type { AuthContext } from "./session.service.ts";

/** Whether the session passed a strong authentication recently enough for a sensitive action. */
export function isRecentlyAuthenticated(auth: Pick<AuthContext, "authenticatedAt">): boolean {
  return Date.now() - auth.authenticatedAt.getTime() <= authConfig.recentAuthSeconds * 1000;
}

/**
 * Guard for sensitive actions. Decided from the session row on the server, never from anything the
 * client sends. Throws `REAUTHENTICATION_REQUIRED` when the session is no longer recent enough.
 */
export function requireRecentAuth(auth: Pick<AuthContext, "authenticatedAt">): void {
  if (!isRecentlyAuthenticated(auth)) {
    throw new ApiError(HttpStatus.FORBIDDEN, "REAUTHENTICATION_REQUIRED", "Confirm your identity to continue");
  }
}
