import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oauthBindingCookieName } from "../auth.config.ts";
import { HttpGoogleOAuthClient } from "./google.client.ts";
import { safeReturnPath } from "./oauth-redirect.ts";

const config = {
  clientId: "client-123.apps.googleusercontent.com",
  clientSecret: "super-secret-client-value",
  redirectUri: "http://localhost:3000/api/v1/auth/google/callback",
};
const NONCE = "expected-nonce";
const KID = "key-1";

const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...signing.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function idToken(
  claims: Record<string, unknown> = {},
  { header = {}, key = signing.privateKey }: { header?: Record<string, unknown>; key?: KeyObject } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    iss: "https://accounts.google.com",
    aud: config.clientId,
    sub: "1234567890",
    email: "Gina@Gmail.test",
    email_verified: true,
    nonce: NONCE,
    iat: now,
    exp: now + 3600,
    ...claims,
  };
  const signingInput = `${b64({ alg: "RS256", typ: "JWT", kid: KID, ...header })}.${b64(body)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(key).toString("base64url");
  return `${signingInput}.${signature}`;
}

const fetchMock = vi.fn();
let requests: { url: string; init?: RequestInit }[];

/** Mocks Google: the token endpoint returns `token`; the key endpoint returns Google's key set. */
function mockGoogle(token: string | (() => Response), keys: unknown[] = [jwk]) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      return typeof token === "function" ? token() : Response.json({ id_token: token, access_token: "must-be-ignored" });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys });
    throw new Error(`unexpected request ${url}`);
  });
}

const identify = (client = new HttpGoogleOAuthClient(config)) =>
  client.identify({ code: "auth-code", codeVerifier: "verifier-value", nonce: NONCE });

beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("HttpGoogleOAuthClient", () => {
  it("builds an authorization-code request with state, nonce and S256 PKCE and no offline access", () => {
    const url = new URL(
      new HttpGoogleOAuthClient(config).authorizationUrl({ state: "s", nonce: "n", codeChallenge: "c" }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid email",
      state: "s",
      nonce: "n",
      code_challenge: "c",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    expect(url.toString()).not.toContain(config.clientSecret);
  });

  it("redeems the code over a POST with the PKCE verifier and returns the verified identity", async () => {
    mockGoogle(idToken());
    await expect(identify()).resolves.toEqual({ subject: "1234567890", email: "gina@gmail.test" });

    const exchange = requests.find((request) => request.url.endsWith("/token"))!;
    expect(exchange.init?.method).toBe("POST");
    const body = new URLSearchParams(String(exchange.init?.body));
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: "authorization_code",
      code: "auth-code",
      code_verifier: "verifier-value",
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
    });
  });

  it("accepts the bare accounts.google.com issuer", async () => {
    mockGoogle(idToken({ iss: "accounts.google.com" }));
    await expect(identify()).resolves.toMatchObject({ subject: "1234567890" });
  });

  it.each([
    ["a different audience", { aud: "someone-elses-client" }],
    ["an untrusted issuer", { iss: "https://evil.example" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ["a missing expiry", { exp: undefined }],
    ["a token issued in the future", { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ["a different nonce", { nonce: "another-flows-nonce" }],
    ["a missing nonce", { nonce: undefined }],
    ["an unverified email", { email_verified: false }],
    ["a missing email", { email: undefined }],
    ["a missing subject", { sub: undefined }],
  ])("rejects %s", async (_name, claims) => {
    mockGoogle(idToken(claims));
    await expect(identify()).rejects.toThrow();
  });

  it("rejects a token signed by a different key", async () => {
    mockGoogle(idToken({}, { key: otherKey.privateKey }));
    await expect(identify()).rejects.toThrow("Invalid ID token signature");
  });

  it("rejects tampered payloads", async () => {
    const [header, , signature] = idToken().split(".");
    const forged = `${header}.${b64({ iss: "https://accounts.google.com", aud: config.clientId, sub: "admin", exp: 9_999_999_999, nonce: NONCE, email: "a@b.test", email_verified: true })}.${signature}`;
    mockGoogle(forged);
    await expect(identify()).rejects.toThrow("Invalid ID token signature");
  });

  it.each([["none"], ["HS256"]])("rejects the %s algorithm", async (alg) => {
    mockGoogle(idToken({}, { header: { alg } }));
    await expect(identify()).rejects.toThrow("algorithm");
  });

  it("rejects a signing key Google does not publish, refreshing the key set once", async () => {
    mockGoogle(idToken({}, { header: { kid: "rotated-away" } }));
    await expect(identify()).rejects.toThrow("Unknown ID token signing key");
    expect(requests.filter((request) => request.url.endsWith("/certs"))).toHaveLength(1);
  });

  it("caches Google's keys between sign-ins", async () => {
    mockGoogle(() => Response.json({ id_token: idToken() }));
    const client = new HttpGoogleOAuthClient(config);
    await identify(client);
    await identify(client);
    expect(requests.filter((request) => request.url.endsWith("/certs"))).toHaveLength(1);
  });

  it("fails without echoing Google's error body, which could contain the code", async () => {
    mockGoogle(() => new Response('{"error":"invalid_grant","detail":"code auth-code was already used"}', { status: 400 }));
    const error = await identify().then(
      () => undefined,
      (caught: unknown) => (caught instanceof Error ? caught : undefined),
    );
    expect(error?.message).toBe("Google token exchange failed (400)");
    expect(error?.message).not.toContain("auth-code");
  });

  it("rejects a token response without an ID token", async () => {
    mockGoogle(() => Response.json({ access_token: "only-an-access-token" }));
    await expect(identify()).rejects.toThrow();
  });
});

describe("safeReturnPath", () => {
  it.each(["/trade", "/activity", "/wallet", "/profile"])("allows %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    undefined,
    null,
    42,
    ["/profile"],
    { path: "/profile" },
    "",
    "profile",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/profile?x=1",
    "/profile#x",
    "/profile/",
    "/profile/../x",
    " /profile",
    "/PROFILE",
  ])("falls back for %j", (value) => {
    expect(safeReturnPath(value)).toBe("/trade");
  });
});

describe("oauthBindingCookieName", () => {
  it("uses the __Host- prefix in production only", () => {
    expect(oauthBindingCookieName(true)).toBe("__Host-oauth-binding");
    expect(oauthBindingCookieName(false)).toBe("oauth-binding");
  });
});
