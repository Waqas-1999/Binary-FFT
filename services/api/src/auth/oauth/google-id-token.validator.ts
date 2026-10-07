import { Logger } from "@nestjs/common";
import { z } from "@repo/validation";

/** The parts of Google's JWKS document that we rely on; other JWK members pass through to Web Crypto. */
const jwkSchema = z
  .object({ kty: z.string(), kid: z.string().optional(), n: z.string().optional(), e: z.string().optional() })
  .loose();
const jwksSchema = z.object({ keys: z.array(jwkSchema) });
type JsonWebKey = z.infer<typeof jwkSchema>;
const tokenResponseSchema = z.object({ id_token: z.string().min(1), access_token: z.string().optional() });
const tokenInfoSchema = z.object({ aud: z.string() });

let cachedKeys: JsonWebKey[] | null = null;
let fetchedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Cached Google public keys from https://www.googleapis.com/oauth2/v3/certs */
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const TOKENINFO_URL = "https://www.googleapis.com/oauth2/v3/tokeninfo";
const ISSUERS = new Set(["https://accounts.google.com", "https://googleaccounts.com"]);

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/** Parses a base64url string into a Buffer. */
function base64urlToBuffer(base64url: string): Buffer {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return Buffer.from(base64, "base64");
}

/**
 * Validates the Google ID token signature client-side against Google's published JWKs.
 * Uses the Web Crypto API (available in Node 22+) to verify without external deps.
*/
async function verifySignature(idToken: string, kid: string, clientId: string): Promise<boolean> {
  if (!crypto.subtle) {
    // Fall back to tokeninfo endpoint if Web Crypto is unavailable.
    return verifyViaTokeninfo(idToken, clientId);
  }

  const [keys] = await fetchJwks();
  return doVerify(keys, idToken, kid, clientId);
}

async function fetchJwks(): Promise<[JsonWebKey[], number]> {
  if (cachedKeys && Date.now() - fetchedAt < CACHE_TTL_MS) return [cachedKeys, fetchedAt];

  const response = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Failed to fetch Google JWKs: ${response.status}`);
  const jwks = jwksSchema.parse(await response.json());
  cachedKeys = jwks.keys;
  fetchedAt = Date.now();
  return [jwks.keys, fetchedAt];
}

async function doVerify(keys: JsonWebKey[], idToken: string, kid: string, clientId: string): Promise<boolean> {
  const jwk = keys.find((key) => key.kid === kid);
  if (!jwk) return verifyViaTokeninfo(idToken, clientId);

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const [header, payload, signature] = idToken.split(".");
    if (!header || !payload || !signature) return false;

    const signingInput = `${header}.${payload}`;
    const sigBuffer = base64urlToBuffer(signature);

    const isValid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      sigBuffer,
      new TextEncoder().encode(signingInput),
    );
    return isValid;
  } catch {
    return verifyViaTokeninfo(idToken, clientId);
  }
}

/** Fallback: validate the ID token by introspecting it via Google's tokeninfo endpoint. */
async function verifyViaTokeninfo(idToken: string, clientId: string): Promise<boolean> {
  try {
    const response = await fetch(`${TOKENINFO_URL}?${new URLSearchParams({ id_token: idToken })}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    const data = tokenInfoSchema.safeParse(await response.json());
    return data.success && data.data.aud === clientId;
  } catch {
    return false;
  }
}

/**
 * Validates a Google ID token server-side. Throws if the token is invalid, expired,
 * has the wrong audience, or was issued by an unknown issuer.
 */
export async function validateGoogleIdToken(idToken: string, clientId: string): Promise<GoogleIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("Malformed ID token");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header to find the key ID
  const header: { kid?: string; alg?: string; typ?: string } = JSON.parse(
    Buffer.from(base64urlToBuffer(headerB64)).toString("utf8"),
  );
  if (header.typ !== "JWT" || header.alg !== "RS256") {
    throw new Error("Unexpected token type or algorithm");
  }

  const signatureBuffer = base64urlToBuffer(signatureB64);
  if (signatureBuffer.length === 0) throw new Error("Empty signature");

  // Verify signature
  const signatureValid = await verifySignature(idToken, header.kid ?? "", clientId);
  if (!signatureValid) throw new Error("Invalid ID token signature");

  // Decode and validate claims
  const payload: {
    iss?: string;
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    exp?: number;
    iat?: number;
  } = JSON.parse(Buffer.from(base64urlToBuffer(payloadB64)).toString("utf8"));

  if (!ISSUERS.has(payload.iss ?? "")) throw new Error("Unknown token issuer");
  if (payload.aud !== clientId) throw new Error("Token audience mismatch");
  if (!payload.sub) throw new Error("Token missing subject");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("Token expired");
  if (payload.iat && payload.iat > now + 300) throw new Error("Token issued in the future");

  const logger = new Logger("GoogleIdTokenValidator");
  logger.log(`Validated Google identity for subject ${payload.sub.slice(0, 8)}...`);

  return {
    sub: payload.sub,
    email: payload.email ?? "",
    emailVerified: payload.email_verified ?? false,
    name: payload.name ?? "",
  };
}

const logger = new Logger("GoogleIdTokenValidator");

/** Exchanges an authorization code for tokens from Google's token endpoint. */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ idToken: string; accessToken?: string }> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`Token exchange failed: ${response.status} ${errorBody.slice(0, 200)}`);
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Token response missing id_token");
    const data = parsed.data;

    return { idToken: data.id_token, accessToken: data.access_token };
  } catch (error) {
    logger.error(`Token exchange error: ${toErrorMessage(error)}`);
    throw error;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
