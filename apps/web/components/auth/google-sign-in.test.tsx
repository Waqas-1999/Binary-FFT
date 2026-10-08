import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthForTests, setAuthenticated } from "../../lib/auth";
import { googleSignInHref, linkResultMessages, lookup, loginErrorMessages } from "../../lib/oauth";
import { ConnectedAccounts } from "../connected-accounts";
import { LoginForm } from "./login-form";
import { SignupForm } from "./signup-form";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const user = { userNumber: 10000, email: "alex@example.com", emailVerified: true, googleConnected: false };

const assign = vi.fn();
const realLocation = window.location;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  resetAuthForTests();
  assign.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, assign, pathname: "/login", search: "", hash: "" },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

function setSearch(search: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, assign, pathname: "/login", search, hash: "" },
  });
}

describe("googleSignInHref", () => {
  it("passes only same-site paths as next", () => {
    expect(googleSignInHref()).toBe("/api/v1/auth/google?next=%2Ftrade");
    expect(googleSignInHref("/profile")).toBe("/api/v1/auth/google?next=%2Fprofile");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      expect(googleSignInHref(bad)).toBe("/api/v1/auth/google?next=%2Ftrade");
    }
  });

  it("only maps known message codes", () => {
    expect(lookup(loginErrorMessages, "oauth_failed")).toBeTruthy();
    expect(lookup(loginErrorMessages, "<script>alert(1)</script>")).toBeUndefined();
    expect(lookup(loginErrorMessages, "constructor")).toBeUndefined();
    expect(lookup(linkResultMessages, null)).toBeUndefined();
  });
});

describe("Continue with Google", () => {
  it("is on the sign-in and sign-up pages and navigates to the API, not to Google directly", async () => {
    render(<LoginForm />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(assign).toHaveBeenCalledWith("/api/v1/auth/google?next=%2Ftrade");

    cleanup();
    render(<SignupForm />);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

  it("carries a safe next route through, and drops an unsafe one", async () => {
    setSearch("?next=/wallet");
    render(<LoginForm />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(assign).toHaveBeenLastCalledWith("/api/v1/auth/google?next=%2Fwallet");

    setSearch("?next=https://evil.example");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(assign).toHaveBeenLastCalledWith("/api/v1/auth/google?next=%2Ftrade");
  });

  it("shows a friendly message, pointing to email sign-in, when a password account already exists", async () => {
    setSearch("?error=oauth_account_exists");
    render(<LoginForm />);
    expect((await screen.findByRole("alert")).textContent).toContain("Sign in with your email and password");
  });

  it("ignores unknown error codes", async () => {
    setSearch("?error=%3Cimg%20src%3Dx%3E");
    render(<LoginForm />);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("ConnectedAccounts", () => {
  it("renders nothing when signed out", () => {
    render(<ConnectedAccounts />);
    expect(screen.queryByText("Connected accounts")).toBeNull();
  });

  it("shows Google as not connected and starts linking with a POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }));
    vi.stubGlobal("fetch", fetchMock);
    setAuthenticated(user);
    render(<ConnectedAccounts />);

    expect(screen.getByText("Not connected")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/google/link", expect.objectContaining({ method: "POST" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1"));
  });

  it("shows Google as connected, without a connect button", () => {
    setAuthenticated({ ...user, googleConnected: true });
    render(<ConnectedAccounts />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("explains a conflict after the redirect back", async () => {
    setSearch("?google=conflict");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { user })));
    setAuthenticated(user);
    render(<ConnectedAccounts />);
    expect((await screen.findByRole("alert")).textContent).toContain("already connected to a different account");
  });
});
