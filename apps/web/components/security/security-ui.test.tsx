import type { SecurityStatus, SessionInfo } from "@repo/types";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthForTests, setAuthenticated } from "../../lib/auth";
import { LoginForm } from "../auth/login-form";
import { PasswordCard } from "./password-card";
import { SecuritySettings } from "./security-settings";
import { SessionsCard } from "./sessions-card";
import { TwoFactorCard } from "./two-factor-card";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// jsdom has no modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const user = { userNumber: 10000, email: "alex@example.com", emailVerified: true, googleConnected: false };
const status = (overrides: Partial<SecurityStatus> = {}, twoFactor: Partial<SecurityStatus["twoFactor"]> = {}): SecurityStatus => ({
  hasPassword: true,
  googleConnected: false,
  twoFactorAvailable: true,
  recentlyAuthenticated: true,
  ...overrides,
  twoFactor: { enabled: false, enabledAt: null, recoveryCodesRemaining: 0, ...twoFactor },
});

function json(statusCode: number, body: unknown): Response {
  return new Response(statusCode === 204 ? null : JSON.stringify(body), { status: statusCode, headers: { "content-type": "application/json" } });
}

/** Routes fetch calls by "METHOD /path". Unlisted calls fail the test loudly. */
function mockApi(routes: Record<string, (body: unknown) => Response>) {
  const calls: { key: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace("/api/v1", "")}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const assign = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  resetAuthForTests();
  assign.mockReset();
  router.replace.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign, pathname: "/login", search: "", hash: "" } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

describe("sign-in with two-factor", () => {
  async function reachChallenge(extra: Record<string, (body: unknown) => Response> = {}) {
    const calls = mockApi({ "POST /auth/login": () => json(200, { status: "two_factor_required" }), ...extra });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "calm-river-sunrise-42");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Enter your authenticator code" })).toBeTruthy();
    return calls;
  }

  it("asks for the code after the password, without signing in or storing anything", async () => {
    await reachChallenge();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Password")).toBeNull(); // the password is gone from the page
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("completes with an authenticator code", async () => {
    const calls = await reachChallenge({ "POST /auth/2fa/verify": () => json(200, { user }) });
    await userEvent.type(screen.getByLabelText("6-digit code"), "123 456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/trade"));
    expect(calls.at(-1)).toEqual({ key: "POST /auth/2fa/verify", body: { code: "123 456" } });
  });

  it.each(["https://evil.example/phish", "//evil.example", "/\\evil.example"])(
    "never follows %s as next after the second factor",
    async (next) => {
      await reachChallenge({ "POST /auth/2fa/verify": () => json(200, { user }) });
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...realLocation, assign, pathname: "/login", search: `?step=two-factor&next=${encodeURIComponent(next)}`, hash: "" },
      });
      await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
      await userEvent.click(screen.getByRole("button", { name: "Verify" }));
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/trade"));
    },
  );

  it("validates the code before calling the API", async () => {
    const calls = await reachChallenge();
    await userEvent.type(screen.getByLabelText("6-digit code"), "12");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getByText("Enter the 6-digit code")).toBeTruthy();
    expect(calls.filter((call) => call.key.includes("2fa"))).toHaveLength(0);
  });

  it("shows a friendly message for a wrong code and lets the person retry", async () => {
    await reachChallenge({ "POST /auth/2fa/verify": () => json(401, { code: "TWO_FACTOR_CODE_INVALID" }) });
    await userEvent.type(screen.getByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect((await screen.findByRole("alert")).textContent).toContain("That code didn't work");
    expect(screen.getByLabelText("6-digit code")).toBeTruthy();
  });

  it("switches to a recovery code", async () => {
    const calls = await reachChallenge({ "POST /auth/2fa/recovery": () => json(200, { user }) });
    await userEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
    expect(screen.getByRole("heading", { name: "Use a recovery code" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Recovery code"), "abcd-efgh-jkmn-pqrs");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/trade"));
    expect(calls.at(-1)).toEqual({ key: "POST /auth/2fa/recovery", body: { code: "abcd-efgh-jkmn-pqrs" } });
  });

  it("sends the person back to sign in when the challenge has expired", async () => {
    await reachChallenge({ "POST /auth/2fa/verify": () => json(401, { code: "TWO_FACTOR_CHALLENGE_INVALID" }) });
    await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("heading", { name: "Sign in again" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeTruthy();
  });

  it("shows the second step after Google sign-in redirects back with ?step=two-factor", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, assign, pathname: "/login", search: "?step=two-factor&next=%2Fwallet", hash: "" },
    });
    mockApi({});
    render(<LoginForm />);
    expect(await screen.findByRole("heading", { name: "Enter your authenticator code" })).toBeTruthy();
  });

  it("does not reveal whether an account has two-factor before the password is accepted", async () => {
    mockApi({ "POST /auth/login": () => json(401, { code: "INVALID_CREDENTIALS" }) });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("don't match");
    expect(screen.queryByText(/authenticator/i)).toBeNull();
  });
});

describe("TwoFactorCard", () => {
  const codes = ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"];

  it("walks through setup and shows the recovery codes once, only in memory", async () => {
    const calls = mockApi({
      "POST /auth/2fa/setup": () =>
        json(200, { otpauthUri: "otpauth://totp/BINERY%20FTT:alex%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=BINERY%20FTT", secret: "JBSWY3DPEHPK3PXP", expiresInSeconds: 600 }),
      "POST /auth/2fa/confirm": () => json(200, { recoveryCodes: codes }),
    });
    const onChanged = vi.fn();
    render(<TwoFactorCard status={status()} onChanged={onChanged} />);
    expect(screen.getByText("Off")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Set up authenticator" }));
    expect(screen.getByRole("heading", { name: "Protect your account" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Scan this QR code with your authenticator app" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "QR code for your authenticator app" })).toBeTruthy();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy(); // manual key for people who can't scan
    await userEvent.click(screen.getByRole("button", { name: "I've added it" }));

    await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));

    expect(await screen.findByRole("heading", { name: "Save your recovery codes" })).toBeTruthy();
    for (const code of codes) expect(screen.getByText(code)).toBeTruthy();
    expect(screen.getByText(/won't be able to see these again/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    expect(calls.at(-1)).toEqual({ key: "POST /auth/2fa/confirm", body: { code: "123456" } });

    // Nothing is persisted, and Done needs an explicit acknowledgement.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    const done = screen.getByRole("button", { name: "Done" }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(done);
    expect(screen.queryByText(codes[0]!)).toBeNull();
    expect(document.body.textContent).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("shows a wrong confirmation code next to the field and keeps the setup", async () => {
    mockApi({
      "POST /auth/2fa/setup": () => json(200, { otpauthUri: "otpauth://totp/x:y?secret=ABCDEFGH", secret: "ABCDEFGH", expiresInSeconds: 600 }),
      "POST /auth/2fa/confirm": () => json(400, { code: "TWO_FACTOR_CODE_INVALID" }),
    });
    render(<TwoFactorCard status={status()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Set up authenticator" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "I've added it" }));
    await userEvent.type(screen.getByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText(/That code didn't work/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeTruthy();
  });

  it("shows the enabled state with the recovery codes left, and no way to see them again", () => {
    mockApi({});
    render(<TwoFactorCard status={status({}, { enabled: true, recoveryCodesRemaining: 7 })} onChanged={vi.fn()} />);
    expect(screen.getByText("On")).toBeTruthy();
    expect(screen.getByText(/7 of 10 recovery codes left/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up authenticator" })).toBeNull();
  });

  it("turns off with a fresh code when recently authenticated, without asking for a password", async () => {
    const calls = mockApi({ "POST /auth/2fa/disable": () => json(204, null) });
    const onChanged = vi.fn();
    render(<TwoFactorCard status={status({}, { enabled: true, recoveryCodesRemaining: 10 })} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Your password")).toBeNull();
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "654321");
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.map((call) => call.key)).toEqual(["POST /auth/2fa/disable"]);
    expect(await screen.findByText("Two-factor authentication is off.")).toBeTruthy();
  });

  it("reauthenticates with the password first when the session is no longer recent", async () => {
    const calls = mockApi({
      "POST /auth/reauthenticate": () => json(204, null),
      "POST /auth/2fa/disable": () => json(204, null),
    });
    render(<TwoFactorCard status={status({ recentlyAuthenticated: false }, { enabled: true, recoveryCodesRemaining: 10 })} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Your password"), "calm-river-sunrise-42");
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "654321");
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toEqual({ key: "POST /auth/reauthenticate", body: { password: "calm-river-sunrise-42" } });
    expect(calls[1]).toEqual({ key: "POST /auth/2fa/disable", body: { code: "654321" } });
  });

  it("shows a wrong password in the dialog and does not try to disable", async () => {
    const calls = mockApi({ "POST /auth/reauthenticate": () => json(401, { code: "INVALID_CREDENTIALS" }) });
    render(<TwoFactorCard status={status({ recentlyAuthenticated: false }, { enabled: true, recoveryCodesRemaining: 10 })} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Your password"), "wrong-password");
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "654321");
    await userEvent.click(within(dialog).getByRole("button", { name: "Turn off" }));

    expect(await within(dialog).findByText("That password isn't right.")).toBeTruthy();
    expect(calls.map((call) => call.key)).toEqual(["POST /auth/reauthenticate"]);
  });

  it("sends Google-only accounts through Google to confirm", async () => {
    const calls = mockApi({ "POST /auth/google/reauth": () => json(200, { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }) });
    render(<TwoFactorCard status={status({ hasPassword: false, recentlyAuthenticated: false }, { enabled: true, recoveryCodesRemaining: 10 })} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Your password")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm with Google" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1"));
    expect(calls).toHaveLength(1);
  });

  it("gets new recovery codes and shows them once", async () => {
    mockApi({ "POST /auth/2fa/recovery-codes": () => json(200, { recoveryCodes: codes }) });
    render(<TwoFactorCard status={status({}, { enabled: true, recoveryCodesRemaining: 3 })} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Get new recovery codes" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "654321");
    await userEvent.click(within(dialog).getByRole("button", { name: "Get new codes" }));
    expect(await screen.findByRole("heading", { name: "Save your recovery codes" })).toBeTruthy();
    expect(screen.getByText(codes[1]!)).toBeTruthy();
  });

  it("says so when the server has no encryption key", () => {
    mockApi({});
    render(<TwoFactorCard status={status({ twoFactorAvailable: false })} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Set up authenticator" })).toBeNull();
    expect(screen.getByText(/isn't available on this server yet/)).toBeTruthy();
  });
});

describe("SessionsCard", () => {
  const sessions: SessionInfo[] = [
    { id: "s-current", current: true, createdAt: "2026-10-07T08:00:00.000Z", lastActiveAt: "2026-10-07T09:00:00.000Z", ipAddress: "203.0.113.5", device: { browser: "Chrome", os: "Windows" } },
    { id: "s-phone", current: false, createdAt: "2026-10-05T08:00:00.000Z", lastActiveAt: "2026-10-06T09:00:00.000Z", ipAddress: null, device: { browser: "Safari", os: "iOS" } },
  ];

  it("lists devices, marks this one in words, and offers sign-out only for the others", async () => {
    mockApi({ "GET /auth/sessions": () => json(200, { sessions }) });
    render(<SessionsCard version={0} onChanged={vi.fn()} />);
    expect(await screen.findByText("Chrome on Windows")).toBeTruthy();
    expect(screen.getByText("This device")).toBeTruthy();
    expect(screen.getByText("Safari on iOS")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Sign out" })).toHaveLength(1);
  });

  it("signs out one device and refreshes the list", async () => {
    let revoked = false;
    const calls = mockApi({
      "GET /auth/sessions": () => json(200, { sessions: revoked ? sessions.slice(0, 1) : sessions }),
      "POST /auth/sessions/s-phone/revoke": () => {
        revoked = true;
        return json(204, null);
      },
    });
    render(<SessionsCard version={0} onChanged={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.queryByText("Safari on iOS")).toBeNull());
    expect(calls.map((call) => call.key)).toContain("POST /auth/sessions/s-phone/revoke");
    expect(screen.getByText("That device has been signed out.")).toBeTruthy();
  });

  it("signs out all other devices, and disables the button when there are none", async () => {
    const onChanged = vi.fn();
    const calls = mockApi({
      "GET /auth/sessions": () => json(200, { sessions }),
      "POST /auth/sessions/revoke-others": () => json(200, { revoked: 1 }),
    });
    render(<SessionsCard version={0} onChanged={onChanged} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out other devices" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.map((call) => call.key)).toContain("POST /auth/sessions/revoke-others");

    cleanup();
    mockApi({ "GET /auth/sessions": () => json(200, { sessions: sessions.slice(0, 1) }) });
    render(<SessionsCard version={0} onChanged={vi.fn()} />);
    await screen.findByText("Chrome on Windows");
    expect((screen.getByRole("button", { name: "Sign out other devices" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("PasswordCard", () => {
  it("explains that Google-only accounts have no password", () => {
    render(<PasswordCard status={status({ hasPassword: false })} onChanged={vi.fn()} />);
    expect(screen.getByText(/no password to change/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
  });

  it("applies the password policy before calling the API", async () => {
    const calls = mockApi({});
    render(<PasswordCard status={status()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Current password"), "calm-river-sunrise-42");
    await userEvent.type(within(dialog).getByLabelText("New password"), "short");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(within(dialog).getByText("Use at least 10 characters")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("changes the password and tells the person other devices were signed out", async () => {
    const calls = mockApi({ "POST /auth/change-password": () => json(200, { status: "password_changed", revokedSessions: 2 }) });
    const onChanged = vi.fn();
    render(<PasswordCard status={status()} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Current password"), "calm-river-sunrise-42");
    await userEvent.type(within(dialog).getByLabelText("New password"), "brand-new-lantern-77");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));

    expect(await screen.findByText(/other devices were signed out/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    expect(calls[0]).toEqual({ key: "POST /auth/change-password", body: { currentPassword: "calm-river-sunrise-42", newPassword: "brand-new-lantern-77" } });
  });

  it("asks for an authenticator code when two-factor is on and shows a wrong current password", async () => {
    const calls = mockApi({ "POST /auth/change-password": () => json(401, { code: "INVALID_CREDENTIALS" }) });
    render(<PasswordCard status={status({}, { enabled: true, recoveryCodesRemaining: 10 })} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Current password"), "not-the-password");
    await userEvent.type(within(dialog).getByLabelText("New password"), "brand-new-lantern-77");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByText("Enter the 6-digit code")).toBeTruthy();
    expect(calls).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "123456");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByText("That password isn't right.")).toBeTruthy();
    expect(calls[0]!.body).toMatchObject({ code: "123456" });
  });
});

describe("SecuritySettings", () => {
  it("loads the status from the server and renders each section", async () => {
    mockApi({
      "GET /auth/security": () => json(200, status({}, { enabled: true, recoveryCodesRemaining: 10 })),
      "GET /auth/sessions": () => json(200, { sessions: [] }),
    });
    setAuthenticated(user);
    render(<SecuritySettings />);
    expect(await screen.findByRole("heading", { name: "Two-factor authentication" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Active sessions" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Password" })).toBeTruthy();
  });

  it("reports the outcome of Google confirmation, then cleans the address bar", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, assign, pathname: "/profile", search: "?reauth=ok", hash: "" },
    });
    const replaceState = vi.spyOn(window.history, "replaceState");
    mockApi({
      "GET /auth/security": () => json(200, status()),
      "GET /auth/sessions": () => json(200, { sessions: [] }),
    });
    setAuthenticated(user);
    render(<SecuritySettings />);
    expect(await screen.findByText(/you're confirmed/)).toBeTruthy();
    expect(replaceState).toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it("renders nothing for signed-out visitors", () => {
    mockApi({});
    const view = render(<SecuritySettings />);
    expect(view.container.textContent).toBe("");
  });
});
