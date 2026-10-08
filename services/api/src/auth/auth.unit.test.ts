import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { readCookie } from "../common/client-info.ts";
import { OriginGuard } from "../common/origin.guard.ts";
import { challengeCookieName, sessionCookieName } from "./auth.config.ts";
import { AuthGuard } from "./auth.guard.ts";
import { PasswordService } from "./password.service.ts";
import type { SessionService } from "./session.service.ts";
import { generateToken, hashToken } from "./tokens.ts";

function httpContext(req: Partial<Request>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => function handler() {} } as unknown as ExecutionContext;
}

function request(headers: Record<string, string>, method = "POST"): Partial<Request> {
  return { method, header: ((name: string) => headers[name.toLowerCase()]) as Request["header"] };
}

describe("PasswordService", () => {
  const passwords = new PasswordService();

  it("hashes with Argon2id and a unique salt per hash", async () => {
    const [a, b] = await Promise.all([passwords.hash("calm-river-sunrise"), passwords.hash("calm-river-sunrise")]);
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("calm-river-sunrise");
  });

  it("verifies correct passwords and rejects wrong ones or malformed hashes", async () => {
    const hash = await passwords.hash("calm-river-sunrise");
    expect(await passwords.verify(hash, "calm-river-sunrise")).toBe(true);
    expect(await passwords.verify(hash, "calm-river-sunset")).toBe(false);
    expect(await passwords.verify("not-a-hash", "calm-river-sunrise")).toBe(false);
    expect(await passwords.verifyAgainstDummy("anything")).toBe(false);
  });
});

describe("tokens", () => {
  it("are 256-bit base64url and hash to a fixed-length digest", () => {
    const token = generateToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(generateToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("AuthGuard", () => {
  const auth = { userId: "user-1", sessionId: "session-1" };
  const guardWith = (authenticate: SessionService["authenticate"]) =>
    new AuthGuard({ readToken: (req: Request) => readCookie(req, "session"), authenticate } as unknown as SessionService);

  it("attaches the session to the request when the cookie is valid", async () => {
    const req = request({ cookie: "theme=dark; session=valid-token" }, "GET");
    const authenticate = vi.fn().mockResolvedValue(auth);

    await expect(guardWith(authenticate).canActivate(httpContext(req))).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith("valid-token");
    expect((req as Request & { auth: unknown }).auth).toEqual(auth);
  });

  it("rejects missing and invalid sessions with 401", async () => {
    const authenticate = vi.fn().mockResolvedValue(null);
    await expect(guardWith(authenticate).canActivate(httpContext(request({}, "GET")))).rejects.toMatchObject({ status: 401 });
    expect(authenticate).not.toHaveBeenCalled();
    await expect(
      guardWith(authenticate).canActivate(httpContext(request({ cookie: "session=revoked" }, "GET"))),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("OriginGuard", () => {
  const guard = new OriginGuard(["http://localhost:3000"]);
  const check = (headers: Record<string, string>, method?: string) => () =>
    guard.canActivate(httpContext(request(headers, method)));

  it("allows safe methods from anywhere", () => {
    expect(check({ origin: "https://evil.example" }, "GET")()).toBe(true);
  });

  it("allows state-changing requests only from allowed origins", () => {
    expect(check({ origin: "http://localhost:3000" })()).toBe(true);
    expect(check({ referer: "http://localhost:3000/login" })()).toBe(true);
    expect(check({ origin: "https://evil.example" })).toThrow();
    expect(check({ referer: "https://evil.example/page" })).toThrow();
    expect(check({})).toThrow();
  });
});

describe("readCookie", () => {
  it("reads one cookie and ignores similarly named ones", () => {
    const req = request({ cookie: "xsession=nope; session=abc%2D1; other=1" }) as Request;
    expect(readCookie(req, "session")).toBe("abc-1");
    expect(readCookie(req, "missing")).toBeUndefined();
  });
});

describe("cookie names", () => {
  it("uses the __Host- prefix for the session and login-challenge cookies in production only", () => {
    expect(sessionCookieName(true)).toBe("__Host-session");
    expect(challengeCookieName(true)).toBe("__Host-login-challenge");
    expect(sessionCookieName(false)).toBe("session");
    expect(challengeCookieName(false)).toBe("login-challenge");
  });
});
