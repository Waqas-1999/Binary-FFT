import { Logger } from "@nestjs/common";
import type { GoogleOAuthConfig } from "@repo/config/server";
import { toErrorMessage } from "@repo/utils";
import { z } from "@repo/validation";

/** A Google account that proved control of a verified email. `subject` is the stable identity. */
export interface GoogleIdentity {
  subject: string;
  email: string;
}

/** Everything BINERY needs from Google. Tests replace it; production uses `HttpGoogleOAuthClient`. */
export interface GoogleOAuthClient {
  /** `forceLogin` asks Google to make the person sign in again (used to reauthenticate). */
  authorizationUrl(params: { state: string; nonce: string; codeChallenge: string; forceLogin?: boolean }): string;
  /** Redeems the code (with PKCE) and returns the validated identity. Throws if anything is off. */
  identify(params: { code: string; codeVerifier: string; nonce: string }): Promise<GoogleIdentity>;
}

export const GOOGLE_OAUTH_CLIENT = Symbol("GOOGLE_OAUTH_CLIENT");

const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const JWKS_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const CLOCK_SKEW_SECONDS = 60;

const jwkSchema = z
  .object({ kty: z.string(), kid: z.string().optional(), n: z.string().optional(), e: z.string().optional() })
  .loose();
const jwksSchema = z.object({ keys: z.array(jwkSchema) });
const tokenResponseSchema = z.object({ id_token: z.string().min(1) });
const headerSchema = z.object({ alg: z.string(), kid: z.string().optional() });
const claimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string().min(1).max(255),
  exp: z.number(),
  iat: z.number().optional(),
  nonce: z.string().optional(),
  email: z.string().min(1).max(254).optional(),
  email_verified: z.boolean().optional(),
});

type Jwk = z.infer<typeof jwkSchema>;

/**
 * Standard authorization-code flow with PKCE, run entirely on the server. Only the ID token is
 * used: it is checked (signature, issuer, audience, expiry, nonce) and then discarded. Access and
 * refresh tokens are never requested or stored, and nothing sensitive is logged.
 */
export class HttpGoogleOAuthClient implements GoogleOAuthClient {
  private readonly logger = new Logger(HttpGoogleOAuthClient.name);
  private keys: { jwks: Jwk[]; fetchedAt: number } | undefined;

  constructor(private readonly config: GoogleOAuthConfig) {}

  authorizationUrl({ state, nonce, codeChallenge, forceLogin = false }: { state: string; nonce: string; codeChallenge: string; forceLogin?: boolean }): string {
    const url = new URL(AUTHORIZATION_URL);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "openid email",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: forceLogin ? "login" : "select_account",
    }).toString();
    return url.toString();
  }

  async identify({ code, codeVerifier, nonce }: { code: string; codeVerifier: string; nonce: string }): Promise<GoogleIdentity> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // The response body can echo request details, so only the status is reported.
    if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);

    const { id_token: idToken } = tokenResponseSchema.parse(await response.json());
    return this.verifyIdToken(idToken, nonce);
  }

  private async verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleIdentity> {
    const parts = idToken.split(".");
    const [headerPart, payloadPart, signaturePart] = parts;
    if (parts.length !== 3 || !headerPart || !payloadPart || !signaturePart) throw new Error("Malformed ID token");

    const header = headerSchema.parse(decodeJson(headerPart));
    if (header.alg !== "RS256" || !header.kid) throw new Error("Unexpected ID token algorithm");

    const jwk = await this.findKey(header.kid);
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      Buffer.from(signaturePart, "base64url"),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) throw new Error("Invalid ID token signature");

    const claims = claimsSchema.parse(decodeJson(payloadPart));
    const now = Math.floor(Date.now() / 1000);
    if (!ISSUERS.has(claims.iss)) throw new Error("Unexpected ID token issuer");
    if (claims.aud !== this.config.clientId) throw new Error("ID token audience mismatch");
    if (claims.exp <= now - CLOCK_SKEW_SECONDS) throw new Error("ID token expired");
    if (claims.iat !== undefined && claims.iat > now + CLOCK_SKEW_SECONDS) throw new Error("ID token issued in the future");
    if (claims.nonce !== expectedNonce) throw new Error("ID token nonce mismatch");
    if (!claims.email || claims.email_verified !== true) throw new Error("Google email is not verified");

    return { subject: claims.sub, email: claims.email.trim().toLowerCase() };
  }

  /** Looks the signing key up in Google's published set, refreshing once if the key is unknown. */
  private async findKey(kid: string): Promise<Jwk> {
    const fresh = this.keys && Date.now() - this.keys.fetchedAt < JWKS_TTL_MS;
    const cached = fresh ? this.keys?.jwks.find((key) => key.kid === kid) : undefined;
    if (cached) return cached;

    try {
      const response = await fetch(JWKS_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const { keys } = jwksSchema.parse(await response.json());
      this.keys = { jwks: keys, fetchedAt: Date.now() };
    } catch (error) {
      this.logger.warn(`Could not fetch Google signing keys: ${toErrorMessage(error)}`);
      throw new Error("Google signing keys unavailable");
    }
    const key = this.keys.jwks.find((candidate) => candidate.kid === kid);
    if (!key) throw new Error("Unknown ID token signing key");
    return key;
  }
}

function decodeJson(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}
