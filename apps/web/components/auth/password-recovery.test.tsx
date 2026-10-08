import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthForTests } from "../../lib/auth";
import { ForgotPasswordForm } from "./forgot-password-form";
import { ResetPasswordForm } from "./reset-password-form";

const token = "A".repeat(43);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  resetAuthForTests();
  window.history.replaceState(null, "", "/reset-password");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("ForgotPasswordForm", () => {
  it("validates the email before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ForgotPasswordForm />);

    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the same neutral confirmation whatever the API knows about the address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { status: "reset_pending" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ForgotPasswordForm />);

    await userEvent.type(screen.getByLabelText("Email"), "Alex@Example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByText(/If an account exists for/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/forgot-password",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "Alex@Example.com" }) }),
    );
  });

  it("shows a friendly message when rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { code: "RATE_LIMITED" })));
    render(<ForgotPasswordForm />);

    await userEvent.type(screen.getByLabelText("Email"), "alex@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Too many attempts. Please wait a few minutes and try again.");
  });
});

describe("ResetPasswordForm", () => {
  it("reads the token from the fragment, removes it from the address bar and waits for the person to submit", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", `/reset-password#token=${token}`);

    render(
      <StrictMode>
        <ResetPasswordForm />
      </StrictMode>,
    );

    expect(await screen.findByRole("heading", { name: "Choose a new password" })).toBeTruthy();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(token);
    expect(document.body.textContent).not.toContain(token);
    // Opening the link (as an email scanner would) must not use the token.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies the password policy before submitting", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", `/reset-password#token=${token}`);
    render(<ResetPasswordForm />);

    await userEvent.type(await screen.findByLabelText("New password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(screen.getByText("Use at least 10 characters")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the token in the request body only when submitted, then asks the person to sign in again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: "password_reset" }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", `/reset-password#token=${token}`);
    render(<ResetPasswordForm />);

    await userEvent.type(await screen.findByLabelText("New password"), "calm-river-sunrise-42");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("heading", { name: "Password updated" })).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/auth/reset-password");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ token, password: "calm-river-sunrise-42" }) });
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(document.body.textContent).not.toContain("calm-river-sunrise-42");
  });

  it("explains an expired or used link and offers a new one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: "PASSWORD_RESET_INVALID" })));
    window.history.replaceState(null, "", `/reset-password#token=${token}`);
    render(<ResetPasswordForm />);

    await userEvent.type(await screen.findByLabelText("New password"), "calm-river-sunrise-42");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("heading", { name: "This link no longer works" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Request a new link" }).getAttribute("href")).toBe("/forgot-password");
  });

  it("shows server-side password issues next to the field and keeps the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(400, { code: "VALIDATION_FAILED", issues: [{ path: "password", message: "Don't use your email in your password" }] }),
      ),
    );
    window.history.replaceState(null, "", `/reset-password#token=${token}`);
    render(<ResetPasswordForm />);

    await userEvent.type(await screen.findByLabelText("New password"), "alexander-is-great-1");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Don't use your email in your password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update password" })).toBeTruthy();
  });

  it.each([
    ["no token", "/reset-password", "Reset your password"],
    ["a malformed token", "/reset-password#token=not-valid", "This link no longer works"],
  ])("handles %s without calling the API", async (_name, url, heading) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", url);
    render(<ResetPasswordForm />);

    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});
