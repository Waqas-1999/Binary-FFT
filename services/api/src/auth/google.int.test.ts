import type { SessionResponse } from "@repo/types";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, responseCookie, sessionCookie, type TestApp } from "../test/test-app.ts";
import type { GoogleIdentity } from "./oauth/google.client.ts";
import { hashToken } from "./tokens.ts";

const WEB = "http://localhost:3000";
const PASSWORD = "calm-river-sunrise-42";
const GINA: GoogleIdentity = { subject: "google-subject-gina", email: "gina@gmail.test" };
const HUGO: GoogleIdentity = { subject: "google-subject-hugo", email: "hugo@gmail.test" };

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface Started {
  response: Response;
  state: string;
  binding: string;
}

/** Browser visits /auth/google; returns what Google would receive and the binding cookie. */
async function startLogin(next?: string): Promise<Started> {
  const query = next === undefined ? "" : `?next=${encodeURIComponent(next)}`;
  const response = await t.request(`/auth/google${query}`, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  return {
    response,
    state: new URL(location, "https://x.test").searchParams.get("state") ?? "",
    binding: responseCookie(response, "oauth-binding") ?? "",
  };
}

/** Signed-in user clicks "Connect Google". */
async function startLink(cookie: string): Promise<Started> {
  const response = await t.request("/auth/google/link", { method: "POST", cookie });
  const body = (await response.clone().json().catch(() => ({}))) as { authorizationUrl?: string };
  return {
    response,
    state: new URL(body.authorizationUrl ?? "https://x.test").searchParams.get("state") ?? "",
    binding: responseCookie(response, "oauth-binding") ?? "",
  };
}

/** Google redirects the browser back to the callback. */
function callback(params: { state: string; code?: string; error?: string }, cookies: (string | undefined)[]): Promise<Response> {
  const query = new URLSearchParams({ state: params.state });
  if (params.code) query.set("code", params.code);
  if (params.error) query.set("error", params.error);
  return t.request(`/auth/google/callback?${query}`, { cookie: cookies.filter(Boolean).join("; "), redirect: "manual" });
}

/** Full sign-in as `identity`: start, approve at Google, callback. */
async function googleSignIn(identity: GoogleIdentity, next?: string) {
  const started = await startLogin(next);
  const code = t.google.approve(started.state, identity);
  const response = await callback({ state: started.state, code }, [started.binding]);
  return { started, code, response, cookie: sessionCookie(response) };
}

/** Full linking of `identity` to the user signed in with `cookie`. */
async function googleLink(identity: GoogleIdentity, cookie: string) {
  const started = await startLink(cookie);
  const code = t.google.approve(started.state, identity);
  const response = await callback({ state: started.state, code }, [started.binding, cookie]);
  return { started, response };
}

async function passwordUser(email: string, verified = true): Promise<string> {
  await t.request("/auth/signup", { method: "POST", body: { email, password: PASSWORD } });
  if (!verified) return "";
  const response = await t.request("/auth/verify-email", { method: "POST", body: { token: t.verificationToken(email) } });
  return sessionCookie(response)!;
}

const location = (response: Response) => response.headers.get("location");
const session = async (cookie: string) => t.request("/auth/session", { cookie });

describe("starting Google sign-in", () => {
  it("redirects to Google with state, nonce and a PKCE challenge, and binds the browser with a cookie", async () => {
    const { response, state, binding } = await startLogin();

    expect(response.status).toBe(302);
    const url = new URL(location(response)!);
    expect(url.origin).toBe("https://accounts.google.test");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("nonce")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("oauth-binding="))!;
    expect(binding).toMatch(/^oauth-binding=[\w-]{43}$/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await t.prisma.authEvent.findMany({ where: { type: "GOOGLE_LOGIN_STARTED" } })).length).toBe(1);
  });

  it("generates unpredictable states and stores only their hash, with a short lifetime", async () => {
    const states = new Set<string>();
    for (let i = 0; i < 15; i++) states.add((await startLogin()).state);
    expect(states.size).toBe(15);
    for (const state of states) expect(state).toMatch(/^[\w-]{43}$/);

    const keys = await t.redis.client.keys("oauth:state:*");
    expect(keys).toHaveLength(15);
    for (const state of states) expect(keys).toContain(`oauth:state:${hashToken(state)}`);
    for (const key of keys) {
      expect(await t.redis.client.ttl(key)).toBeGreaterThan(0);
      expect(await t.redis.client.ttl(key)).toBeLessThanOrEqual(600);
      expect(await t.redis.client.get(key)).not.toContain([...states][0]!);
    }
  });

  it("limits how often sign-in can be started per IP and says 'unavailable' rather than failing noisily", async () => {
    for (let i = 0; i < 20; i++) expect((await startLogin()).response.status).toBe(302);
    const limited = await startLogin();
    expect(limited.response.status).toBe(302);
    expect(location(limited.response)).toBe(`${WEB}/login?error=oauth_unavailable`);
  });

  it("fails closed, with a friendly redirect, when Redis is unavailable", async () => {
    vi.spyOn(t.redis.client, "multi").mockImplementation(() => {
      throw new Error("redis down");
    });
    const { response } = await startLogin();
    expect(location(response)).toBe(`${WEB}/login?error=oauth_unavailable`);
    expect(response.headers.getSetCookie().join()).not.toContain("oauth-binding");
  });
});

describe("OAuth state validation", () => {
  it("rejects a callback with an unknown state without redeeming the code", async () => {
    const { binding, state } = await startLogin();
    const code = t.google.approve(state, GINA);
    const response = await callback({ state: "x".repeat(43), code }, [binding]);

    expect(location(response)).toBe(`${WEB}/login?error=oauth_failed`);
    expect(sessionCookie(response)).toBeUndefined();
    expect(t.google.seen).toHaveLength(0);
    expect(await t.prisma.user.count()).toBe(0);
  });

  it("rejects callbacks without a state, without a code, or when the user denied access", async () => {
    const noState = await t.request("/auth/google/callback?code=abc", { redirect: "manual" });
    expect(location(noState)).toBe(`${WEB}/login?error=oauth_failed`);

    const first = await startLogin();
    const noCode = await callback({ state: first.state }, [first.binding]);
    expect(location(noCode)).toBe(`${WEB}/login?error=oauth_failed`);

    const second = await startLogin();
    const denied = await callback({ state: second.state, error: "access_denied" }, [second.binding]);
    expect(location(denied)).toBe(`${WEB}/login?error=oauth_failed`);
    expect(t.google.seen).toHaveLength(0);
    expect(await t.prisma.user.count()).toBe(0);
  });

  it("is single-use: replaying a completed callback signs nobody in", async () => {
    const { started, code, response, cookie } = await googleSignIn(GINA);
    expect(cookie).toBeTruthy();
    expect(location(response)).toBe(`${WEB}/trade`);

    const replay = await callback({ state: started.state, code }, [started.binding]);
    expect(location(replay)).toBe(`${WEB}/login?error=oauth_failed`);
    expect(sessionCookie(replay)).toBeUndefined();
    expect(await t.prisma.session.count()).toBe(1);
    expect(await t.redis.client.keys("oauth:state:*")).toHaveLength(0);
  });

  it("expires", async () => {
    const { state, binding } = await startLogin();
    const code = t.google.approve(state, GINA);
    const [key] = await t.redis.client.keys("oauth:state:*");
    await t.redis.client.pexpire(key!, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const response = await callback({ state, code }, [binding]);
    expect(location(response)).toBe(`${WEB}/login?error=oauth_failed`);
    expect(await t.prisma.user.count()).toBe(0);
  });

  it("is bound to the browser that started the flow (login CSRF)", async () => {
    const attacker = await startLogin();
    const code = t.google.approve(attacker.state, HUGO);

    // The victim's browser is lured to the callback with the attacker's state and code: no binding cookie.
    const withoutBinding = await callback({ state: attacker.state, code }, []);
    expect(location(withoutBinding)).toBe(`${WEB}/login?error=oauth_failed`);
    expect(sessionCookie(withoutBinding)).toBeUndefined();

    // Nor does another browser's binding work, and the state is gone either way.
    const other = await startLogin();
    const wrongBinding = await callback({ state: attacker.state, code }, [other.binding]);
    expect(location(wrongBinding)).toBe(`${WEB}/login?error=oauth_failed`);
    expect(await t.prisma.user.count()).toBe(0);
    expect(t.google.seen).toHaveLength(0);
  });

  it("consumes the state even when the binding is wrong, so a leaked state cannot be retried", async () => {
    const victim = await startLogin();
    const code = t.google.approve(victim.state, GINA);
    await callback({ state: victim.state, code }, ["oauth-binding=wrong"]);
    const retry = await callback({ state: victim.state, code }, [victim.binding]);
    expect(location(retry)).toBe(`${WEB}/login?error=oauth_failed`);
  });

  it("clears the binding cookie on every callback", async () => {
    const { started, response } = await googleSignIn(GINA);
    expect(started.binding).toBeTruthy();
    expect(response.headers.getSetCookie().find((value) => value.startsWith("oauth-binding="))).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("proves possession of the PKCE verifier and nonce to Google", async () => {
    await googleSignIn(GINA);
    expect(t.google.seen).toHaveLength(1);
    expect(t.google.seen[0]!.codeVerifier).toMatch(/^[\w-]{43}$/);
    expect(t.google.seen[0]!.nonce).toMatch(/^[\w-]{43}$/);
  });

  it("treats a rejected Google identity as a generic failure", async () => {
    const started = await startLogin();
    const response = await callback({ state: started.state, code: "code-google-never-issued" }, [started.binding]);
    expect(location(response)).toBe(`${WEB}/login?error=oauth_failed`);
    expect(await t.prisma.user.count()).toBe(0);
    const [event] = await t.prisma.authEvent.findMany({ where: { type: "GOOGLE_LOGIN_FAILED" } });
    expect(event!.metadata).toEqual({ reason: "identity_rejected" });
  });
});

describe("Google sign-in", () => {
  it("creates a user without a password account and signs them in", async () => {
    const { response, cookie } = await googleSignIn(GINA);

    expect(location(response)).toBe(`${WEB}/trade`);
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith("session="))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Expires=/);

    const user = await t.prisma.user.findFirstOrThrow({
      select: { userNumber: true, status: true, emailAccount: true, oAuthIdentities: true },
    });
    expect(user.userNumber).toBeGreaterThanOrEqual(10000);
    expect(user.status).toBe("ACTIVE");
    expect(user.emailAccount).toBeNull();
    expect(user.oAuthIdentities).toHaveLength(1);
    expect(user.oAuthIdentities[0]).toMatchObject({
      provider: "GOOGLE",
      providerSubject: GINA.subject,
      emailAtLinkTime: GINA.email,
    });

    const me = (await (await session(cookie!)).json()) as SessionResponse;
    expect(me.user).toEqual({ userNumber: user.userNumber, email: GINA.email, emailVerified: true, googleConnected: true });
  });

  it("uses the normal server-side session: only a hash of a random token is stored", async () => {
    const { cookie } = await googleSignIn(GINA);
    const token = cookie!.split("=")[1]!;
    expect(token).toMatch(/^[\w-]{43}$/);
    const stored = await t.prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
      select: { revokedAt: true, expiresAt: true, ipAddress: true, userAgent: true },
    });
    expect(stored.revokedAt).toBeNull();
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(stored.ipAddress).toBeTruthy();
    expect(JSON.stringify(await t.prisma.session.findMany())).not.toContain(token);
  });

  it("signs the same Google account into the same user every time, without duplicates", async () => {
    const first = await googleSignIn(GINA);
    const second = await googleSignIn(GINA);

    expect(first.cookie).not.toBe(second.cookie);
    expect(await t.prisma.user.count()).toBe(1);
    expect(await t.prisma.oAuthIdentity.count()).toBe(1);
    expect(await t.prisma.session.count()).toBe(2);
    expect(await t.prisma.authEvent.count({ where: { type: "USER_CREATED" } })).toBe(1);
    expect(await t.prisma.authEvent.count({ where: { type: "GOOGLE_LOGIN_SUCCESS" } })).toBe(2);
  });

  it("identifies users by Google's subject, not by email", async () => {
    await googleSignIn(GINA);
    const renamed = await googleSignIn({ subject: GINA.subject, email: "gina.new@gmail.test" });
    expect(renamed.cookie).toBeTruthy();
    expect(await t.prisma.user.count()).toBe(1);

    // A different subject that happens to report the same email is a different person.
    await googleSignIn({ subject: "another-subject", email: GINA.email });
    expect(await t.prisma.user.count()).toBe(2);
  });

  it("can never give one Google identity to two users", async () => {
    await googleSignIn(GINA);
    const other = await t.prisma.user.create({ data: {}, select: { id: true } });
    await expect(
      t.prisma.oAuthIdentity.create({ data: { userId: other.id, provider: "GOOGLE", providerSubject: GINA.subject } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("creates only one user when the same new account completes twice at once", async () => {
    const [a, b] = await Promise.all([startLogin(), startLogin()]);
    const codes = [t.google.approve(a.state, GINA), t.google.approve(b.state, GINA)];
    const [first, second] = await Promise.all([
      callback({ state: a.state, code: codes[0]! }, [a.binding]),
      callback({ state: b.state, code: codes[1]! }, [b.binding]),
    ]);

    expect([location(first), location(second)]).toEqual([`${WEB}/trade`, `${WEB}/trade`]);
    expect(await t.prisma.user.count()).toBe(1);
    expect(await t.prisma.oAuthIdentity.count()).toBe(1);
  });

  it("does not let disabled users in", async () => {
    await googleSignIn(GINA);
    await t.prisma.user.updateMany({ data: { status: "DISABLED" } });

    const { response, cookie } = await googleSignIn(GINA);
    expect(location(response)).toBe(`${WEB}/login?error=oauth_failed`);
    expect(cookie).toBeUndefined();
    expect(await t.prisma.session.count({ where: { revokedAt: null } })).toBe(1); // only the earlier one
  });

  it("never silently links Google to a verified password account with the same email", async () => {
    await passwordUser(GINA.email);
    const accountBefore = await t.prisma.emailAccount.findUniqueOrThrow({ where: { email: GINA.email } });

    const { response, cookie } = await googleSignIn(GINA);

    expect(location(response)).toBe(`${WEB}/login?error=oauth_account_exists`);
    expect(cookie).toBeUndefined();
    expect(await t.prisma.user.count()).toBe(1);
    expect(await t.prisma.oAuthIdentity.count()).toBe(0);
    expect(await t.prisma.emailAccount.findUniqueOrThrow({ where: { email: GINA.email } })).toEqual(accountBefore);
    expect(response.headers.getSetCookie().find((value) => value.startsWith("session="))).toBeUndefined();
  });

  it("does not merge into, or take over, an unverified password account either", async () => {
    await passwordUser(GINA.email, false); // e.g. someone pre-registering with a victim's address
    const { cookie } = await googleSignIn(GINA);

    expect(cookie).toBeTruthy();
    expect(await t.prisma.user.count()).toBe(2);
    const squatter = await t.prisma.emailAccount.findUniqueOrThrow({
      where: { email: GINA.email },
      select: { user: { select: { oAuthIdentities: true } }, emailVerifiedAt: true },
    });
    expect(squatter.user.oAuthIdentities).toHaveLength(0);
    expect(squatter.emailVerifiedAt).toBeNull();
  });

  it("can be signed out like any session", async () => {
    const { cookie } = await googleSignIn(GINA);
    expect((await session(cookie!)).status).toBe(200);

    const logout = await t.request("/auth/logout", { method: "POST", cookie });
    expect(logout.status).toBe(204);
    expect((await session(cookie!)).status).toBe(401);
    expect(await t.prisma.session.count({ where: { revokedAt: null } })).toBe(0);
  });
});

describe("redirect safety", () => {
  it("lands on an allowlisted internal route when one is requested", async () => {
    const { response } = await googleSignIn(GINA, "/profile");
    expect(location(response)).toBe(`${WEB}/profile`);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://localhost:3000.evil.example",
    "/trade@evil.example",
    "/trade?next=https://evil.example",
    "/trade/../../evil",
    "/trade#https://evil.example",
    "/unknown-route",
    "",
  ])("never redirects to %j", async (next) => {
    const { response } = await googleSignIn(GINA, next);
    expect(location(response)).toBe(`${WEB}/trade`);
  });

  it("ignores repeated or non-string next parameters", async () => {
    const started = await t.request("/auth/google?next[]=https://evil.example&next[]=/profile", { redirect: "manual" });
    const state = new URL(location(started)!).searchParams.get("state")!;
    const code = t.google.approve(state, GINA);
    const response = await callback({ state, code }, [responseCookie(started, "oauth-binding")]);
    expect(location(response)).toBe(`${WEB}/trade`);
  });

  it("only ever redirects to this site", async () => {
    const outcomes = [
      await googleSignIn(GINA, "https://evil.example"),
      await callback({ state: "bad" }, []),
      await googleSignIn({ subject: "s2", email: "s2@gmail.test" }, "//evil.example"),
    ];
    for (const outcome of outcomes) {
      const response = "response" in outcome ? outcome.response : outcome;
      expect(new URL(location(response)!).origin).toBe(WEB);
    }
  });
});

describe("linking Google to a signed-in account", () => {
  it("requires an authenticated session", async () => {
    const response = await t.request("/auth/google/link", { method: "POST" });
    expect(response.status).toBe(401);
    expect(responseCookie(response, "oauth-binding")).toBeUndefined();

    const afterLogout = await passwordUser("ada@example.com");
    await t.request("/auth/logout", { method: "POST", cookie: afterLogout });
    expect((await t.request("/auth/google/link", { method: "POST", cookie: afterLogout })).status).toBe(401);
    expect(await t.redis.client.keys("oauth:state:*")).toHaveLength(0);
  });

  it("cannot be started by a request from another origin", async () => {
    const cookie = await passwordUser("ada@example.com");
    const response = await t.request("/auth/google/link", { method: "POST", cookie, origin: "https://evil.example" });
    expect(response.status).toBe(403);
  });

  it("is not available as a GET navigation", async () => {
    const cookie = await passwordUser("ada@example.com");
    const response = await t.request("/auth/google/link", { cookie, redirect: "manual" });
    expect(response.status).toBe(404);
  });

  it("lets a signed-in user explicitly connect their Google account", async () => {
    const cookie = await passwordUser("ada@example.com");
    const before = (await (await session(cookie)).json()) as SessionResponse;
    expect(before.user.googleConnected).toBe(false);

    const { started, response } = await googleLink(GINA, cookie);
    expect(started.response.status).toBe(200);
    expect(started.state).toMatch(/^[\w-]{43}$/);
    expect(location(response)).toBe(`${WEB}/profile?google=linked`);

    const identity = await t.prisma.oAuthIdentity.findFirstOrThrow({ include: { user: { select: { emailAccount: true } } } });
    expect(identity.user.emailAccount!.email).toBe("ada@example.com");
    expect(identity).toMatchObject({ provider: "GOOGLE", providerSubject: GINA.subject });

    const after = (await (await session(cookie)).json()) as SessionResponse;
    expect(after.user).toMatchObject({ email: "ada@example.com", googleConnected: true });
    expect(await t.prisma.user.count()).toBe(1);

    const types = (await t.prisma.authEvent.findMany({ where: { type: { in: ["GOOGLE_LINK_STARTED", "GOOGLE_LINK_SUCCESS"] } }, orderBy: { createdAt: "asc" } })).map((event) => event.type);
    expect(types).toEqual(["GOOGLE_LINK_STARTED", "GOOGLE_LINK_SUCCESS"]);
  });

  it("lets a user who could not sign in with Google connect it, then sign in with it as the same user", async () => {
    const cookie = await passwordUser(GINA.email);
    expect(location((await googleSignIn(GINA)).response)).toBe(`${WEB}/login?error=oauth_account_exists`);

    await googleLink(GINA, cookie);
    const { cookie: googleCookie, response } = await googleSignIn(GINA);
    expect(location(response)).toBe(`${WEB}/trade`);
    expect(await t.prisma.user.count()).toBe(1);

    const viaGoogle = (await (await session(googleCookie!)).json()) as SessionResponse;
    const viaPassword = (await (await session(cookie)).json()) as SessionResponse;
    expect(viaGoogle.user.userNumber).toBe(viaPassword.user.userNumber);
  });

  it("is idempotent for the same Google account", async () => {
    const cookie = await passwordUser("ada@example.com");
    await googleLink(GINA, cookie);
    const again = await googleLink(GINA, cookie);
    expect(location(again.response)).toBe(`${WEB}/profile?google=linked`);
    expect(await t.prisma.oAuthIdentity.count()).toBe(1);
  });

  it("refuses to take a Google account that belongs to another user, and merges nothing", async () => {
    const owner = (await googleSignIn(GINA)).cookie!;
    const thiefCookie = await passwordUser("mallory@example.com");
    const users = await t.prisma.user.count();

    const { response } = await googleLink(GINA, thiefCookie);

    expect(location(response)).toBe(`${WEB}/profile?google=conflict`);
    const identities = await t.prisma.oAuthIdentity.findMany({ select: { userId: true, user: { select: { emailAccount: true } } } });
    expect(identities).toHaveLength(1);
    expect(identities[0]!.user.emailAccount).toBeNull(); // still the Google-only user
    expect(await t.prisma.user.count()).toBe(users);
    expect(((await (await session(owner)).json()) as SessionResponse).user.googleConnected).toBe(true);
    expect(((await (await session(thiefCookie)).json()) as SessionResponse).user.googleConnected).toBe(false);

    const [conflict] = await t.prisma.authEvent.findMany({ where: { type: "GOOGLE_LINK_CONFLICT" } });
    expect(conflict!.userId).not.toBeNull();
    expect(await t.prisma.authEvent.count({ where: { type: "GOOGLE_LINK_CONFLICT" } })).toBe(1);
  });

  it("will not link a second, different Google account to the same user", async () => {
    const cookie = await passwordUser("ada@example.com");
    await googleLink(GINA, cookie);
    const { response } = await googleLink(HUGO, cookie);

    expect(location(response)).toBe(`${WEB}/profile?google=failed`);
    const identities = await t.prisma.oAuthIdentity.findMany();
    expect(identities.map((identity) => identity.providerSubject)).toEqual([GINA.subject]);
  });

  it("needs the same signed-in session at the callback; a state alone attaches nothing", async () => {
    const cookie = await passwordUser("ada@example.com");
    const other = await passwordUser("bob@example.com");

    // No session cookie at the callback.
    const first = await startLink(cookie);
    const withoutSession = await callback({ state: first.state, code: t.google.approve(first.state, GINA) }, [first.binding]);
    expect(location(withoutSession)).toBe(`${WEB}/profile?google=failed`);

    // A different user's session at the callback.
    const second = await startLink(cookie);
    const wrongUser = await callback({ state: second.state, code: t.google.approve(second.state, GINA) }, [second.binding, other]);
    expect(location(wrongUser)).toBe(`${WEB}/profile?google=failed`);

    expect(await t.prisma.oAuthIdentity.count()).toBe(0);
  });

  it("cannot be completed in a browser other than the one that started it", async () => {
    const cookie = await passwordUser("ada@example.com");
    const started = await startLink(cookie);
    const code = t.google.approve(started.state, GINA);
    const response = await callback({ state: started.state, code }, [cookie]); // right session, no binding
    expect(location(response)).toMatch(/\/login\?error=oauth_failed$/);
    expect(await t.prisma.oAuthIdentity.count()).toBe(0);
  });

  it("does not let a link state sign anyone in, and a sign-in state cannot link", async () => {
    const cookie = await passwordUser("ada@example.com");
    const loginFlow = await startLogin();
    const code = t.google.approve(loginFlow.state, GINA);
    // Presenting a sign-in state together with a signed-in session still only signs in.
    const response = await callback({ state: loginFlow.state, code }, [loginFlow.binding, cookie]);
    expect(location(response)).toBe(`${WEB}/trade`);
    const identity = await t.prisma.oAuthIdentity.findFirstOrThrow({ include: { user: { select: { emailAccount: true } } } });
    expect(identity.user.emailAccount).toBeNull(); // a new Google-only user, not the signed-in one
  });

  it("does not let a disabled user link", async () => {
    const cookie = await passwordUser("ada@example.com");
    const started = await startLink(cookie);
    const code = t.google.approve(started.state, GINA);
    await t.prisma.user.updateMany({ data: { status: "DISABLED" } });

    const response = await callback({ state: started.state, code }, [started.binding, cookie]);
    expect(location(response)).toBe(`${WEB}/profile?google=failed`);
    expect(await t.prisma.oAuthIdentity.count()).toBe(0);
  });

  it("limits how often a user can start linking", async () => {
    const cookie = await passwordUser("ada@example.com");
    for (let i = 0; i < 5; i++) expect((await startLink(cookie)).response.status).toBe(200);
    expect((await startLink(cookie)).response.status).toBe(429);
  });
});

describe("logging", () => {
  it("never writes OAuth state, codes, binding values, tokens or sessions to the logs", async () => {
    const output: string[] = [];
    const capture = (chunk: string | Uint8Array) => {
      output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    };
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = capture as typeof process.stdout.write;
    process.stderr.write = capture as typeof process.stderr.write;

    let secrets: string[];
    try {
      const { started, code, cookie } = await googleSignIn(GINA);
      const link = await passwordUser("ada@example.com");
      const linking = await googleLink(HUGO, link);
      await callback({ state: started.state, code }, [started.binding]); // replay
      await callback({ state: "forged-state-value-1234567890", code: "forged-code-value" }, []);
      const failing = await startLogin();
      await callback({ state: failing.state, code: "unissued-code-abc" }, [failing.binding]);

      secrets = [
        started.state,
        started.binding.split("=")[1]!,
        code,
        cookie!.split("=")[1]!,
        linking.started.state,
        linking.started.binding.split("=")[1]!,
        link.split("=")[1]!,
        "forged-state-value-1234567890",
        "forged-code-value",
        "unissued-code-abc",
        ...t.google.seen.flatMap((seen) => [seen.codeVerifier, seen.nonce]),
      ];
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }

    const logs = output.join("");
    expect(logs).toContain("GET /api/v1/auth/google/callback"); // logging was captured, path only
    expect(logs).not.toMatch(/callback\?/);
    for (const secret of secrets) expect(logs).not.toContain(secret);
  });

  it("keeps secrets out of auth events", async () => {
    const { started, code, cookie } = await googleSignIn(GINA);
    await callback({ state: started.state, code }, [started.binding]);
    const events = JSON.stringify(await t.prisma.authEvent.findMany());
    for (const secret of [started.state, started.binding.split("=")[1]!, code, cookie!.split("=")[1]!]) {
      expect(events).not.toContain(secret);
    }
  });
});
