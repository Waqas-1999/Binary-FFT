import type { NotificationPreferencesResponse, ProfileResponse } from "@repo/types";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthForTests, setAuthenticated } from "../../lib/auth";
import { MobileCard } from "./mobile-card";
import { NotificationSettings } from "./notification-settings";
import { ProfileSettings } from "./profile-settings";
import { TelegramCard } from "./telegram-card";

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

const user = { userNumber: 10042, email: "alex@example.com", emailVerified: true, googleConnected: false };

const profile = (overrides: Partial<ProfileResponse> = {}): ProfileResponse => ({
  userNumber: 10042,
  displayName: null,
  email: "alex@example.com",
  emailVerified: true,
  avatar: { kind: "initials", text: "A" },
  mobile: { masked: null, verified: false, pending: null, available: true },
  google: { connected: false },
  telegram: { connected: false, available: true },
  settings: { timeZone: null },
  ...overrides,
});

const prefs = (overrides: Partial<NotificationPreferencesResponse> = {}): NotificationPreferencesResponse => ({
  email: { security: true, account: true, trading: true, promotions: false },
  telegram: { connected: false, security: true, account: true, trading: true, promotions: false },
  push: { available: false },
  ...overrides,
});

function json(statusCode: number, body?: unknown): Response {
  return new Response(statusCode === 204 ? null : JSON.stringify(body ?? {}), { status: statusCode, headers: { "content-type": "application/json" } });
}

type Handler = (body: unknown) => Response;

/** Routes fetch calls by "METHOD /path". Unlisted calls fail the test loudly. */
function mockApi(routes: Record<string, Handler | Handler[]>) {
  const calls: { key: string; body: unknown }[] = [];
  const queues = new Map<string, Handler[]>();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace("/api/v1", "")}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const route = routes[key];
    if (!route) throw new Error(`Unexpected request: ${key}`);
    if (!Array.isArray(route)) return route(body);
    const queue = queues.get(key) ?? [...route];
    queues.set(key, queue);
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return next(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const reauthRequired = () => json(403, { code: "REAUTHENTICATION_REQUIRED" });

const assign = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  resetAuthForTests();
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign, pathname: "/profile", search: "", hash: "" } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

describe("ProfileSettings", () => {
  it("shows the account number, verified email and the editable fields", async () => {
    setAuthenticated(user);
    mockApi({ "GET /profile": () => json(200, profile({ displayName: "Alex Rivera" })) });
    render(<ProfileSettings />);

    expect(await screen.findByText("10042", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("alex@example.com")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Alex Rivera");
    expect(screen.getByRole("img", { name: "Alex Rivera" }).textContent).toBe("AR");
    expect(screen.getByRole("heading", { name: "Mobile number" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Telegram" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Connected accounts" })).toBeTruthy(); // Phase 2B Google card is kept
  });

  it("asks signed-out visitors to sign in", () => {
    mockApi({ "GET /auth/session": () => json(401, { code: "UNAUTHENTICATED" }) });
    render(<ProfileSettings />);
    return screen.findByRole("heading", { name: "You're not signed in" });
  });

  it("saves a trimmed display name and a time zone together", async () => {
    setAuthenticated(user);
    const calls = mockApi({
      "GET /profile": () => json(200, profile()),
      "PATCH /profile": () => json(200, profile({ displayName: "Alex Rivera", settings: { timeZone: "Europe/London" } })),
    });
    render(<ProfileSettings />);

    const save = await screen.findByRole("button", { name: "Save changes" });
    expect((save as HTMLButtonElement).disabled).toBe(true); // nothing changed yet
    await userEvent.type(screen.getByLabelText("Display name"), "  Alex Rivera ");
    await userEvent.selectOptions(screen.getByLabelText("Time zone"), "Europe/London");
    await userEvent.click(save);

    expect(await screen.findByText("Your changes are saved.")).toBeTruthy();
    expect(calls.find((call) => call.key === "PATCH /profile")!.body).toEqual({ displayName: "Alex Rivera", timeZone: "Europe/London" });
  });

  it("refuses unsafe names before calling the API", async () => {
    setAuthenticated(user);
    const calls = mockApi({ "GET /profile": () => json(200, profile()) });
    render(<ProfileSettings />);
    await userEvent.type(await screen.findByLabelText("Display name"), "<b>Alex</b>");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Don't use < or > in your name")).toBeTruthy();
    expect(calls.some((call) => call.key === "PATCH /profile")).toBe(false);
  });

  it("renders a hostile name as plain text", async () => {
    setAuthenticated(user);
    mockApi({ "GET /profile": () => json(200, profile({ displayName: "<img src=x onerror=alert(1)>" })) });
    const { container } = render(<ProfileSettings />);
    await screen.findByRole("heading", { name: "<img src=x onerror=alert(1)>" });
    expect(container.querySelector("img[src='x']")).toBeNull();
  });

  it("shows the server's verdict when Google sends the person back after confirming", async () => {
    setAuthenticated(user);
    mockApi({ "GET /profile": () => json(200, profile()) });
    Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign, pathname: "/profile", search: "?reauth=ok", hash: "" } });
    render(<ProfileSettings />);
    expect(await screen.findByText(/you're confirmed/)).toBeTruthy();
  });
});

describe("MobileCard", () => {
  const renderCard = (value: ProfileResponse) => {
    const onChanged = vi.fn();
    const view = render(<MobileCard profile={value} onChanged={onChanged} />);
    return { onChanged, view };
  };

  it("says so when no SMS provider is configured", () => {
    renderCard(profile({ mobile: { masked: null, verified: false, pending: null, available: false } }));
    expect(screen.getByText(/isn't available right now/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add mobile number" })).toBeNull();
  });

  it("is optional and starts with a single, clear call to action", () => {
    renderCard(profile());
    expect(screen.getByText("Optional. Not needed to sign in or trade.")).toBeTruthy();
    expect(screen.getByText("Not verified")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add mobile number" })).toBeTruthy();
  });

  it("walks through add, send code, enter code, verified", async () => {
    const calls = mockApi({
      "POST /profile/mobile/send-code": () => json(200, { status: "code_sent", expiresInSeconds: 600, resendAfterSeconds: 60 }),
      "POST /profile/mobile/verify": () => json(204),
    });
    const { onChanged, view } = renderCard(profile());

    await userEvent.click(screen.getByRole("button", { name: "Add mobile number" }));
    await userEvent.type(screen.getByLabelText("Mobile number"), "+91 98765 43210");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls.at(-1)).toEqual({ key: "POST /profile/mobile/send-code", body: { phoneNumber: "+919876543210" } });

    // The server now reports a pending number (masked), which is what the page shows.
    view.rerender(
      <MobileCard profile={profile({ mobile: { masked: null, verified: false, pending: { masked: "+********3210", expiresAt: "2030-01-01T00:00:00Z" }, available: true } })} onChanged={onChanged} />,
    );
    expect(screen.getByText(/Code expires in 10 minutes\./)).toBeTruthy();
    expect(screen.getByText("+********3210")).toBeTruthy();
    expect(screen.queryByText(/9876/)).toBeNull();
    expect((screen.getByRole("button", { name: /Resend code in/ }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText("6-digit code"), "123 456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Your mobile number is verified.")).toBeTruthy();
    expect(calls.at(-1)).toEqual({ key: "POST /profile/mobile/verify", body: { code: "123456" } });
  });

  it("checks the number and the code locally before calling the API", async () => {
    const calls = mockApi({});
    const { view, onChanged } = renderCard(profile());
    await userEvent.click(screen.getByRole("button", { name: "Add mobile number" }));
    await userEvent.type(screen.getByLabelText("Mobile number"), "9876543210");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText(/country code/, { selector: "p[id$='-error']" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    view.rerender(<MobileCard profile={profile({ mobile: { masked: null, verified: false, pending: { masked: "+********3210", expiresAt: "2030-01-01T00:00:00Z" }, available: true } })} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Enter the 6-digit code")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("shows a wrong code next to the field and lets the person retry", async () => {
    mockApi({ "POST /profile/mobile/verify": () => json(400, { code: "PHONE_CODE_INVALID" }) });
    renderCard(profile({ mobile: { masked: null, verified: false, pending: { masked: "+********3210", expiresAt: "2030-01-01T00:00:00Z" }, available: true } }));
    await userEvent.type(screen.getByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("That code didn't work. Check it, or ask for a new one.")).toBeTruthy();
    expect(screen.getByLabelText("6-digit code").getAttribute("aria-invalid")).toBe("true");
  });

  it("asks the person to confirm it's them when the session is no longer recent, then carries on", async () => {
    const calls = mockApi({
      "POST /profile/mobile/send-code": [reauthRequired, () => json(200, { status: "code_sent", expiresInSeconds: 600, resendAfterSeconds: 60 })],
      "GET /auth/security": () => json(200, { hasPassword: true }),
      "POST /auth/reauthenticate": () => json(204),
    });
    const { onChanged } = renderCard(profile());
    await userEvent.click(screen.getByRole("button", { name: "Add mobile number" }));
    await userEvent.type(screen.getByLabelText("Mobile number"), "+14155550123");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm it's you" });
    await userEvent.type(within(dialog).getByLabelText("Your password"), "calm-river-sunrise-42");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.map((call) => call.key)).toEqual(["POST /profile/mobile/send-code", "GET /auth/security", "POST /auth/reauthenticate", "POST /profile/mobile/send-code"]);
    expect(calls.at(-1)!.body).toEqual({ phoneNumber: "+14155550123" });
  });

  it("sends Google-only accounts through Google to confirm", async () => {
    mockApi({
      "POST /profile/mobile/send-code": reauthRequired,
      "GET /auth/security": () => json(200, { hasPassword: false }),
      "POST /auth/google/reauth": () => json(200, { authorizationUrl: "https://accounts.google.test/auth" }),
    });
    renderCard(profile());
    await userEvent.click(screen.getByRole("button", { name: "Add mobile number" }));
    await userEvent.type(screen.getByLabelText("Mobile number"), "+14155550123");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm with Google" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.test/auth"));
  });

  it("shows only the masked number once verified, and removes it after confirmation", async () => {
    const calls = mockApi({ "DELETE /profile/mobile": () => json(204) });
    const { onChanged } = renderCard(profile({ mobile: { masked: "+********3210", verified: true, pending: null, available: true } }));
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("+********3210")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove mobile number?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove number" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.at(-1)!.key).toBe("DELETE /profile/mobile");
  });

  it("keeps the number in memory only", async () => {
    mockApi({ "POST /profile/mobile/send-code": () => json(200, { status: "code_sent", expiresInSeconds: 600, resendAfterSeconds: 60 }) });
    renderCard(profile());
    await userEvent.click(screen.getByRole("button", { name: "Add mobile number" }));
    await userEvent.type(screen.getByLabelText("Mobile number"), "+14155550123");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(screen.queryByLabelText("Mobile number")).toBeNull());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("TelegramCard", () => {
  const renderCard = (value: ProfileResponse) => {
    const onChanged = vi.fn();
    const view = render(<TelegramCard profile={value} onChanged={onChanged} />);
    return { onChanged, view };
  };

  it("offers to connect, and says it is not a way to sign in", () => {
    renderCard(profile());
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getByText(/isn't used to sign in/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Telegram" })).toBeTruthy();
  });

  it("explains when Telegram is not configured", () => {
    renderCard(profile({ telegram: { connected: false, available: false } }));
    expect(screen.getByText("Telegram isn't available right now.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Telegram" })).toBeNull();
  });

  it("opens the bot through a safe link and waits for the connection", async () => {
    const calls = mockApi({ "POST /profile/telegram/link": () => json(200, { url: "https://t.me/binery_bot?start=abc", expiresInSeconds: 600 }) });
    const { onChanged } = renderCard(profile());
    await userEvent.click(screen.getByRole("button", { name: "Connect Telegram" }));

    const open = await screen.findByRole("link", { name: "Open Telegram" });
    expect(open.getAttribute("href")).toBe("https://t.me/binery_bot?start=abc");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(/Press Start/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Check connection" }));
    expect(onChanged).toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(localStorage.length).toBe(0);
  });

  it("checks again by itself while waiting", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({ "POST /profile/telegram/link": () => json(200, { url: "https://t.me/binery_bot?start=abc", expiresInSeconds: 600 }) });
    const { onChanged } = renderCard(profile());
    await userEvent.click(screen.getByRole("button", { name: "Connect Telegram" }));
    await screen.findByRole("link", { name: "Open Telegram" });
    expect(onChanged).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4100);
    expect(onChanged).toHaveBeenCalled();
  });

  it("announces the connection once the profile says so", async () => {
    mockApi({ "POST /profile/telegram/link": () => json(200, { url: "https://t.me/binery_bot?start=abc", expiresInSeconds: 600 }) });
    const { view, onChanged } = renderCard(profile());
    await userEvent.click(screen.getByRole("button", { name: "Connect Telegram" }));
    await screen.findByRole("link", { name: "Open Telegram" });

    view.rerender(<TelegramCard profile={profile({ telegram: { connected: true, available: true } })} onChanged={onChanged} />);
    expect(await screen.findByText("Telegram is connected.")).toBeTruthy();
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Telegram" })).toBeNull();
  });

  it("confirms before disconnecting, and says sign-in is unaffected", async () => {
    const calls = mockApi({ "DELETE /profile/telegram": () => json(204) });
    const { onChanged } = renderCard(profile({ telegram: { connected: true, available: true } }));
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog", { name: "Disconnect Telegram?" });
    expect(within(dialog).getByText(/Signing in isn't affected/)).toBeTruthy();
    expect(calls).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.at(-1)!.key).toBe("DELETE /profile/telegram");
    expect(await screen.findByText("Telegram was disconnected.")).toBeTruthy();
  });

  it("asks for confirmation of identity before connecting when the session is stale", async () => {
    const calls = mockApi({
      "POST /profile/telegram/link": [reauthRequired, () => json(200, { url: "https://t.me/binery_bot?start=abc", expiresInSeconds: 600 })],
      "GET /auth/security": () => json(200, { hasPassword: true }),
      "POST /auth/reauthenticate": () => json(204),
    });
    renderCard(profile());
    await userEvent.click(screen.getByRole("button", { name: "Connect Telegram" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm it's you" });
    await userEvent.type(within(dialog).getByLabelText("Your password"), "calm-river-sunrise-42");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("link", { name: "Open Telegram" })).toBeTruthy();
    expect(calls.filter((call) => call.key === "POST /profile/telegram/link")).toHaveLength(2);
  });

  it("shows a friendly message, not a technical one, when connecting fails", async () => {
    mockApi({ "POST /profile/telegram/link": () => json(503, { code: "FEATURE_UNAVAILABLE", message: "webhook secret missing" }) });
    renderCard(profile());
    await userEvent.click(screen.getByRole("button", { name: "Connect Telegram" }));
    expect(await screen.findByText("This isn't available right now. Please try again later.")).toBeTruthy();
    expect(screen.queryByText(/webhook/)).toBeNull();
    expect(screen.getByRole("button", { name: "Connect Telegram" })).toBeTruthy(); // clear retry path
  });
});

describe("NotificationSettings", () => {
  it("groups settings, keeps security email required, and hides Telegram until it is connected", async () => {
    setAuthenticated(user);
    mockApi({ "GET /notifications/preferences": () => json(200, prefs()) });
    render(<NotificationSettings />);

    const security = (await screen.findByRole("switch", { name: "Security emails" })) as HTMLInputElement;
    expect(security.checked).toBe(true);
    expect(security.disabled).toBe(true);
    expect(screen.getByText("Required")).toBeTruthy();
    for (const name of ["Security", "Account", "Trading", "Promotions"]) expect(screen.getByRole("heading", { name })).toBeTruthy();

    expect((screen.getByRole("switch", { name: "Promotions and offers by email" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("switch", { name: "Account updates by email" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("switch", { name: /Telegram/ })).toBeNull();
    expect(screen.getByText(/Push notifications aren't available yet/)).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /push/i })).toBeNull();
  });

  it("saves a change and reflects what the server returns", async () => {
    setAuthenticated(user);
    const calls = mockApi({
      "GET /notifications/preferences": () => json(200, prefs()),
      "PATCH /notifications/preferences": () => json(200, prefs({ email: { security: true, account: true, trading: true, promotions: true } })),
    });
    render(<NotificationSettings />);
    const promotions = await screen.findByRole("switch", { name: "Promotions and offers by email" });
    await userEvent.click(promotions);

    await waitFor(() => expect((screen.getByRole("switch", { name: "Promotions and offers by email" }) as HTMLInputElement).checked).toBe(true));
    expect(calls.at(-1)).toEqual({ key: "PATCH /notifications/preferences", body: { email: { promotions: true } } });
  });

  it("shows Telegram options only for a connected account", async () => {
    setAuthenticated(user);
    const calls = mockApi({
      "GET /notifications/preferences": () => json(200, prefs({ telegram: { connected: true, security: true, account: true, trading: true, promotions: false } })),
      "PATCH /notifications/preferences": () => json(200, prefs({ telegram: { connected: true, security: true, account: true, trading: false, promotions: false } })),
    });
    render(<NotificationSettings />);
    await userEvent.click(await screen.findByRole("switch", { name: "Trade results and activity on Telegram" }));
    await waitFor(() => expect(calls.at(-1)!.key).toBe("PATCH /notifications/preferences"));
    expect(calls.at(-1)!.body).toEqual({ telegram: { trading: false } });
    expect(screen.getByRole("switch", { name: "Security alerts on Telegram" })).toBeTruthy();
  });

  it("keeps the last known state and explains when saving fails", async () => {
    setAuthenticated(user);
    mockApi({
      "GET /notifications/preferences": () => json(200, prefs()),
      "PATCH /notifications/preferences": () => json(429, { code: "RATE_LIMITED" }),
    });
    render(<NotificationSettings />);
    await userEvent.click(await screen.findByRole("switch", { name: "Promotions and offers by email" }));
    expect(await screen.findByText(/Too many attempts/)).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Promotions and offers by email" }) as HTMLInputElement).checked).toBe(false);
  });

  it("renders nothing for signed-out visitors", () => {
    mockApi({ "GET /auth/session": () => json(401, { code: "UNAUTHENTICATED" }) });
    const { container } = render(<NotificationSettings />);
    expect(container.textContent).toBe("");
  });
});
