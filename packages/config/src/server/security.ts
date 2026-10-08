import type { ServerEnv } from "./env.ts";

export interface SecurityConfig {
  /** 32-byte AES-256-GCM key for TOTP secrets, or undefined when two-factor is not configured (non-production only). */
  twoFactorKey: Buffer | undefined;
}

export function securityConfig(env: ServerEnv): SecurityConfig {
  return {
    twoFactorKey: env.TWO_FACTOR_ENCRYPTION_KEY ? Buffer.from(env.TWO_FACTOR_ENCRYPTION_KEY, "base64") : undefined,
  };
}
