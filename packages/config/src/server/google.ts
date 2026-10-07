import type { ServerEnv } from "./env.ts";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Returns the Google OAuth client settings, or undefined when Google sign-in is not configured. */
export function googleOAuthConfig(env: ServerEnv): GoogleOAuthConfig | undefined {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) return undefined;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
}
